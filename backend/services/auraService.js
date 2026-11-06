import fs from 'fs';
import path from 'path';
import { researchUtils } from './researchService.js';

// Aura ranks a user-chosen list of YouTube channels by views gained over a
// timeframe, using ViewStats daily channel stats. Ported from StoryRank.
export const AURA_TIMEFRAMES = {
    '24h': { range: 7, days: 1 },
    '7d': { range: 7, days: 7 },
    '30d': { range: 28, days: 28 }
};

const MAX_CHANNELS = 50;
const STATS_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_ROLL_MS = 6 * 60 * 60 * 1000;
const FETCH_CONCURRENCY = 5;

// "Excellent" performance per timeframe; each component saturates toward 100.
const BENCHMARKS = {
    '24h': { views: 500_000, avgViews: 200_000, videos: 2 },
    '7d': { views: 3_000_000, avgViews: 300_000, videos: 10 },
    '30d': { views: 10_000_000, avgViews: 500_000, videos: 30 }
};
const WEIGHTS = { views: 0.4, subs: 0.2, engagement: 0.2, velocity: 0.15, consistency: 0.05 };

function saturate(ratio, k = 2) {
    return Math.min(100, 100 * (1 - Math.exp(-k * Math.max(0, ratio))));
}

// Aura score (0-100), same formula as StoryRank's SR score.
export function calculateAuraScore(stats, timeframe) {
    const benchmark = BENCHMARKS[timeframe] || BENCHMARKS['30d'];
    const subsGrowthRate = stats.totalSubscribers > 0
        ? stats.subsGained / stats.totalSubscribers
        : stats.subsGained / 1000;
    const score =
        saturate(stats.viewsGained / benchmark.views) * WEIGHTS.views +
        saturate(subsGrowthRate / 0.02) * WEIGHTS.subs +
        saturate((stats.engagementRate || 0) / 5) * WEIGHTS.engagement +
        saturate(stats.avgViewsPerVideo / benchmark.avgViews) * WEIGHTS.velocity +
        saturate(stats.videosPublished / benchmark.videos, 3) * WEIGHTS.consistency;
    return Math.min(Math.max(Math.round(score * 10) / 10, 0), 100);
}

// Sums the most recent `days` of ViewStats daily records into period totals.
export function summarizeDailyStats(records, days) {
    const sorted = [...(records || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
    const latest = sorted[0] || {};
    const period = sorted.slice(0, days);
    const viewsGained = period.reduce((sum, r) => sum + (r.viewCountDelta || 0), 0);
    const subsGained = period.reduce((sum, r) => sum + (r.subscriberCountDelta || 0), 0);
    const videosPublished = Math.max(0, period.reduce((sum, r) => sum + (r.videoCountDelta || 0), 0));
    return {
        totalSubscribers: latest.subscriberCount || 0,
        totalViews: latest.viewCount || 0,
        viewsGained,
        subsGained,
        videosPublished,
        avgViewsPerVideo: videosPublished > 0 ? Math.round(viewsGained / videosPublished) : 0,
        engagementRate: 0,
        dailyViews: [...period].reverse().map(r => ({ date: r.date, views: r.viewCountDelta || 0 }))
    };
}

// Accepts "@handle", a bare "handle", a channel ID, or a YouTube channel URL.
export function normalizeAuraHandle(value) {
    const input = String(value || '').trim();
    const isBareHandle = /^[\w.-]+$/.test(input) && !/^UC[\w-]{20,}$/.test(input);
    return researchUtils.normalizeIdentifier(isBareHandle ? `@${input}` : input);
}

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

export function createAuraService({ supabase, research, dataDir, isMissingColumnError }) {
    const settingsFile = path.join(dataDir, 'aura_settings.json');
    const snapshotsFile = path.join(dataDir, 'aura_snapshots.json');
    const statsCache = new Map();

    function readJson(file) {
        try {
            if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            console.error(`[Aura] Failed to read ${file}:`, error.message);
        }
        return {};
    }

    function writeJson(file, data) {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    }

    // Supabase `user_settings.aura_handles` when the column exists, else backend/data/aura_settings.json.
    async function getChannels(userId) {
        if (supabase) {
            const { data, error } = await supabase
                .from('user_settings')
                .select('aura_handles')
                .eq('user_id', userId)
                .maybeSingle();
            // An empty column falls through so lists saved locally before the migration still show up.
            if (!error && data?.aura_handles?.length) return data.aura_handles;
            if (error && !isMissingColumnError(error)) throw error;
        }
        return readJson(settingsFile)[userId]?.channels || [];
    }

    async function saveChannels(userId, channels) {
        if (supabase) {
            const { error } = await supabase
                .from('user_settings')
                .upsert({ user_id: userId, aura_handles: channels, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
            if (!error) {
                // Supabase is now the source of truth; drop the pre-migration local copy.
                const all = readJson(settingsFile);
                if (all[userId]) {
                    delete all[userId];
                    writeJson(settingsFile, all);
                }
                return;
            }
            if (!isMissingColumnError(error)) throw error;
        }
        const all = readJson(settingsFile);
        all[userId] = { channels, updatedAt: new Date().toISOString() };
        writeJson(settingsFile, all);
    }

    async function addChannel(userId, input) {
        const identifier = normalizeAuraHandle(input);
        const channels = await getChannels(userId);
        if (channels.length >= MAX_CHANNELS) throw new Error(`Aura can rank up to ${MAX_CHANNELS} channels`);
        const resolved = await research.resolveViaViewstats(identifier).catch(error => {
            throw /\(404\)/.test(error.message) ? new Error(`${identifier} was not found on YouTube`) : error;
        });
        if (channels.some(channel => channel.channelId === resolved.channelId)) {
            throw new Error(`${resolved.handle || resolved.title} is already in your Aura rank`);
        }
        const channel = {
            channelId: resolved.channelId,
            handle: resolved.handle || identifier,
            title: resolved.title,
            thumbnailUrl: resolved.thumbnailUrl
        };
        const updated = [...channels, channel];
        await saveChannels(userId, updated);
        return updated;
    }

    async function removeChannel(userId, channelId) {
        const channels = await getChannels(userId);
        const updated = channels.filter(channel => channel.channelId !== channelId);
        await saveChannels(userId, updated);
        return updated;
    }

    async function fetchStats(channelId, range) {
        const key = `${channelId}:${range}`;
        const cached = statsCache.get(key);
        if (cached && Date.now() - cached.fetchedAt < STATS_TTL_MS) return cached;
        const payload = await research.viewstatsRequest(
            `/channels/${encodeURIComponent(channelId)}/stats?range=${range}&groupBy=daily&sortOrder=ASC&withRevenue=false&withEvents=false&withBreakdown=false&withToday=false`
        );
        const records = Array.isArray(payload?.data) ? payload.data : [];
        if (!records.length) throw new Error('ViewStats has no stats for this channel');
        const entry = { records, fetchedAt: Date.now() };
        statsCache.set(key, entry);
        return entry;
    }

    // Rank change compares against a per-user snapshot that rolls forward every 6 hours.
    function applyRankChanges(userId, timeframe, entries) {
        const all = readJson(snapshotsFile);
        const key = `${userId}:${timeframe}`;
        const snapshot = all[key] || {};
        const currentRanks = Object.fromEntries(entries.map(entry => [entry.channelId, entry.rank]));
        const previous = snapshot.previous || {};
        for (const entry of entries) {
            const previousRank = previous[entry.channelId];
            entry.previousRank = previousRank ?? null;
            entry.rankChange = previousRank ? previousRank - entry.rank : 0;
        }
        if (!snapshot.takenAt || Date.now() - new Date(snapshot.takenAt).getTime() >= SNAPSHOT_ROLL_MS) {
            all[key] = { previous: snapshot.current || currentRanks, current: currentRanks, takenAt: new Date().toISOString() };
            try {
                writeJson(snapshotsFile, all);
            } catch (error) {
                console.error('[Aura] Failed to save rank snapshot:', error.message);
            }
        }
    }

    async function getLeaderboard(userId, timeframe) {
        const config = AURA_TIMEFRAMES[timeframe];
        if (!config) throw new Error('Invalid timeframe');
        const channels = await getChannels(userId);
        const errors = [];
        const results = await mapLimit(channels, FETCH_CONCURRENCY, async channel => {
            try {
                const { records, fetchedAt } = await fetchStats(channel.channelId, config.range);
                const stats = summarizeDailyStats(records, config.days);
                return { ...channel, ...stats, score: calculateAuraScore(stats, timeframe), fetchedAt: new Date(fetchedAt).toISOString() };
            } catch (error) {
                errors.push({ channelId: channel.channelId, handle: channel.handle, message: error.message });
                return null;
            }
        });
        const entries = results.filter(Boolean).sort((a, b) => b.viewsGained - a.viewsGained);
        entries.forEach((entry, index) => { entry.rank = index + 1; });
        applyRankChanges(userId, timeframe, entries);
        const lastUpdated = entries.reduce((oldest, entry) => (!oldest || entry.fetchedAt < oldest ? entry.fetchedAt : oldest), null);
        return { timeframe, entries, errors, channelCount: channels.length, lastUpdated: lastUpdated || new Date().toISOString() };
    }

    return { addChannel, getChannels, getLeaderboard, removeChannel };
}
