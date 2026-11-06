import { webcrypto } from 'crypto';
import { YoutubeTranscript } from 'youtube-transcript';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const VIEWSTATS_API_BASE = 'https://api.viewstats.com';
const TIMEFRAME_DAYS = { '7d': 7, '28d': 28, '90d': 90, '365d': 365, max: null };
// ViewStats takes ~15s per channel, so a 50-channel group must not be fetched serially
const RESEARCH_CONCURRENCY = 10;

async function mapWithConcurrency(items, limit, fn) {
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

function normalizeIdentifier(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error('Enter a YouTube @handle or channel ID');
    const urlMatch = input.match(/youtube\.com\/(?:channel\/([^/?#]+)|(@[^/?#]+))/i);
    const identifier = urlMatch ? (urlMatch[1] || urlMatch[2]) : input;
    if (identifier.startsWith('@') || /^UC[\w-]{20,}$/.test(identifier)) return identifier;
    throw new Error('Use a valid @handle, channel ID, or YouTube channel URL');
}

function normalizeHandle(value) {
    if (!value) return null;
    const handle = String(value).trim();
    return handle.startsWith('@') ? handle : `@${handle}`;
}

function parseCount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseDuration(value = '') {
    const match = String(value).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function cutoffFor(timeframe) {
    const days = TIMEFRAME_DAYS[timeframe];
    return days ? Date.now() - days * 86400000 : null;
}

function collapseRepeatedTranscriptSegments(segments) {
    const collapsed = [];
    let index = 0;
    while (index < segments.length) {
        let repeatedBlock = null;
        const maxBlockSize = Math.min(12, Math.floor((segments.length - index) / 2));
        for (let size = 1; size <= maxBlockSize; size += 1) {
            const block = segments.slice(index, index + size);
            const next = segments.slice(index + size, index + size * 2);
            if (block.every((line, offset) => line.toLowerCase() === next[offset]?.toLowerCase())) {
                repeatedBlock = block;
                let repeats = 2;
                while (
                    index + size * (repeats + 1) <= segments.length
                    && block.every((line, offset) => line.toLowerCase() === segments[index + size * repeats + offset]?.toLowerCase())
                ) repeats += 1;
                collapsed.push(...block);
                index += size * repeats;
                break;
            }
        }
        if (!repeatedBlock) {
            collapsed.push(segments[index]);
            index += 1;
        }
    }
    return collapsed;
}

function cleanTranscript(value) {
    const segments = String(value || '')
        .replace(/\\n/g, '\n')
        .replace(/(?:[\u200B-\u200F\u2060\uFEFF]+\s*)+/g, '\n')
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
        .replace(/\[[^\]\r\n]*music[^\]\r\n]*\]/gi, ' ')
        .replace(/>>\s*/g, '')
        .split(/[\r\n]+/)
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    return collapseRepeatedTranscriptSegments(segments).join(' ').replace(/\s+/g, ' ').trim();
}

function decodeByteArray(value) {
    return new Uint8Array(JSON.parse(Buffer.from(value, 'base64').toString('utf8')));
}

function mapViewstatsVideo(video) {
    return {
        id: video.id,
        channelId: video.channelId,
        channelTitle: video.channelName || null,
        channelHandle: normalizeHandle(video.channelHandle),
        channelThumbnailUrl: video.channelAvatarUrl || null,
        title: video.title || 'Untitled video',
        description: video.description || '',
        publishedAt: video.uploadDate || null,
        thumbnailUrl: video.latestThumbnail?.imageUrl || null,
        durationSeconds: parseCount(video.duration) || 0,
        views: parseCount(video.viewCount) || 0,
        likes: parseCount(video.likeCount) || 0,
        comments: parseCount(video.commentCount) || 0,
        isShort: Boolean(video.shorts),
        outlierScore: parseCount(video.outlierScore),
        averageViews: parseCount(video.averageViews)
    };
}

export function createResearchService({ supabase, fetchImpl = fetch, env = process.env }) {
    // readBody runs inside the timeout so a stalled response body can't hang the request
    async function fetchWithTimeout(url, options = {}, readBody = response => response) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetchImpl(url, { ...options, signal: controller.signal });
            return await readBody(response);
        } finally {
            clearTimeout(timeout);
        }
    }

    async function decryptViewstats(response) {
        const ivValue = env.VIEWSTATS_IV_B64;
        const keyValue = env.VIEWSTATS_KEY_B64;
        if (!ivValue || !keyValue) throw new Error('ViewStats decryption is not configured');
        const cryptoKey = await webcrypto.subtle.importKey('raw', decodeByteArray(keyValue), { name: 'AES-GCM' }, false, ['decrypt']);
        const decrypted = await webcrypto.subtle.decrypt(
            { name: 'AES-GCM', iv: decodeByteArray(ivValue) },
            cryptoKey,
            await response.arrayBuffer()
        );
        return JSON.parse(new TextDecoder().decode(decrypted));
    }

    async function viewstatsRequest(path) {
        if (!env.VIEWSTATS_BEARER_TOKEN) throw new Error('ViewStats is not configured');
        return fetchWithTimeout(`${VIEWSTATS_API_BASE}${path}`, {
            headers: { Authorization: `Bearer ${env.VIEWSTATS_BEARER_TOKEN}` }
        }, async response => {
            if (!response.ok) throw new Error(`ViewStats request failed (${response.status})`);
            return decryptViewstats(response);
        });
    }

    async function youtubeRequest(resource, params, apiKeys) {
        if (!apiKeys.length) throw new Error('Add a YouTube API key before using YouTube mode');
        let lastError;
        for (const apiKey of apiKeys) {
            const url = new URL(`${YOUTUBE_API_BASE}/${resource}`);
            Object.entries({ ...params, key: apiKey }).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
            });
            const { response, data } = await fetchWithTimeout(url, {}, async res => ({ response: res, data: await res.json() }));
            if (response.ok) return data;
            lastError = new Error(data?.error?.message || `YouTube request failed (${response.status})`);
            const reason = data?.error?.errors?.[0]?.reason;
            if (!['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].includes(reason)) break;
        }
        throw lastError || new Error('YouTube request failed');
    }

    async function getYoutubeKeys(userId) {
        const { data, error } = await supabase
            .from('user_settings')
            .select('youtube_api_key_1, youtube_api_key_2')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;
        return [data?.youtube_api_key_1, data?.youtube_api_key_2].filter(Boolean);
    }

    async function resolveViaViewstats(identifier) {
        const payload = await viewstatsRequest(`/channels/${encodeURIComponent(identifier)}/videos?orderBy=uploadDate&limit=1&offset=0&withThumbnail=true`);
        const first = payload?.data?.[0];
        if (!first?.channelId) throw new Error('Channel was not found on ViewStats or has no videos');
        return {
            channelId: first.channelId,
            handle: normalizeHandle(first.channelHandle || (identifier.startsWith('@') ? identifier : null)),
            title: first.channelName || first.channelId,
            thumbnailUrl: first.channelAvatarUrl || null
        };
    }

    async function resolveViaYoutube(identifier, apiKeys) {
        const params = identifier.startsWith('@')
            ? { part: 'snippet,contentDetails', forHandle: identifier.slice(1) }
            : { part: 'snippet,contentDetails', id: identifier };
        const payload = await youtubeRequest('channels', params, apiKeys);
        const channel = payload?.items?.[0];
        if (!channel) throw new Error('Channel was not found on YouTube');
        return {
            channelId: channel.id,
            handle: normalizeHandle(channel.snippet?.customUrl || (identifier.startsWith('@') ? identifier : null)),
            title: channel.snippet?.title || channel.id,
            thumbnailUrl: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || null
        };
    }

    async function saveChannelMetadata(channel) {
        const { error } = await supabase.from('youtube_channels').upsert({
            channel_id: channel.channelId,
            handle: channel.handle,
            title: channel.title,
            thumbnail_url: channel.thumbnailUrl,
            updated_at: new Date().toISOString()
        }, { onConflict: 'channel_id' });
        if (error) throw error;
    }

    async function requireGroup(userId, groupId) {
        if (!groupId) throw new Error('Select a research group');
        const { data, error } = await supabase
            .from('research_groups')
            .select('id, name')
            .eq('id', groupId)
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Research group was not found');
        return data;
    }

    async function listGroups(userId) {
        const { data, error } = await supabase
            .from('research_groups')
            .select('id, name, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return data || [];
    }

    async function createGroup(userId, name) {
        const normalizedName = String(name || '').trim();
        if (!normalizedName || normalizedName.length > 80) throw new Error('Group name must be between 1 and 80 characters');
        const { data, error } = await supabase
            .from('research_groups')
            .insert({ user_id: userId, name: normalizedName })
            .select('id, name, created_at')
            .single();
        if (error?.code === '23505') throw new Error('A group with that name already exists');
        if (error) throw error;
        return data;
    }

    async function renameGroup(userId, groupId, name) {
        await requireGroup(userId, groupId);
        const normalizedName = String(name || '').trim();
        if (!normalizedName || normalizedName.length > 80) throw new Error('Group name must be between 1 and 80 characters');
        const { data, error } = await supabase
            .from('research_groups')
            .update({ name: normalizedName })
            .eq('id', groupId)
            .eq('user_id', userId)
            .select('id, name, created_at')
            .single();
        if (error?.code === '23505') throw new Error('A group with that name already exists');
        if (error) throw error;
        return data;
    }

    async function removeGroup(userId, groupId) {
        const { error } = await supabase.from('research_groups').delete().eq('id', groupId).eq('user_id', userId);
        if (error) throw error;
    }

    async function listChannels(userId, groupId) {
        await requireGroup(userId, groupId);
        const { data, error } = await supabase
            .from('research_group_channels')
            .select('id, channel_id, created_at, youtube_channels(channel_id, handle, title, thumbnail_url)')
            .eq('user_id', userId)
            .eq('group_id', groupId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        return (data || []).map(row => ({
            id: row.id,
            channelId: row.channel_id,
            handle: row.youtube_channels?.handle || null,
            title: row.youtube_channels?.title || row.channel_id,
            thumbnailUrl: row.youtube_channels?.thumbnail_url || null
        }));
    }

    async function addChannels(userId, groupId, identifiers, source) {
        await requireGroup(userId, groupId);
        const uniqueIdentifiers = [...new Set((identifiers || []).map(value => String(value).trim()).filter(Boolean))];
        if (uniqueIdentifiers.length === 0) throw new Error('Enter at least one channel');
        if (uniqueIdentifiers.length > 50) throw new Error('Add no more than 50 channels at once');
        const apiKeys = source === 'youtube' ? await getYoutubeKeys(userId) : [];
        const channels = [];
        const errors = [];
        for (const identifier of uniqueIdentifiers) {
            try {
                const normalized = normalizeIdentifier(identifier);
                const channel = source === 'youtube'
                    ? await resolveViaYoutube(normalized, apiKeys)
                    : await resolveViaViewstats(normalized);
                await saveChannelMetadata(channel);
                const { data, error } = await supabase.from('research_group_channels').upsert({
                    user_id: userId,
                    group_id: groupId,
                    channel_id: channel.channelId
                }, { onConflict: 'group_id,channel_id' }).select('id').single();
                if (error) throw error;
                channels.push({ id: data.id, ...channel });
            } catch (error) {
                errors.push({ identifier, message: error.message });
            }
        }
        return { channels, errors };
    }

    async function addChannel(userId, groupId, identifier, source) {
        const result = await addChannels(userId, groupId, [identifier], source);
        if (!result.channels.length) throw new Error(result.errors[0]?.message || 'Failed to add channel');
        return result.channels[0];
    }

    async function removeChannel(userId, id) {
        const { error } = await supabase.from('research_group_channels').delete().eq('id', id).eq('user_id', userId);
        if (error) throw error;
    }

    async function viewstatsChannelResearch(channel, timeframe) {
        const videosPayload = await viewstatsRequest(`/channels/${encodeURIComponent(channel.channelId)}/videos?orderBy=uploadDate&limit=100&offset=0&withThumbnail=true`);
        const cutoff = cutoffFor(timeframe);
        const videos = (videosPayload?.data || [])
            .map(mapViewstatsVideo)
            .filter(video => !cutoff || (video.publishedAt && new Date(video.publishedAt).getTime() >= cutoff));
        const firstVideo = videosPayload?.data?.[0];
        const resolved = {
            channelId: firstVideo?.channelId || channel.channelId,
            handle: normalizeHandle(firstVideo?.channelHandle || channel.handle),
            title: firstVideo?.channelName || channel.title,
            thumbnailUrl: firstVideo?.channelAvatarUrl || channel.thumbnailUrl
        };
        return { channel: resolved, videos };
    }

    async function youtubeChannelResearch(channel, timeframe, apiKeys) {
        const channelPayload = await youtubeRequest('channels', {
            part: 'snippet,contentDetails',
            id: channel.channelId
        }, apiKeys);
        const item = channelPayload?.items?.[0];
        if (!item) throw new Error('Channel was not found on YouTube');
        const uploads = item.contentDetails?.relatedPlaylists?.uploads;
        const entries = [];
        const cutoff = cutoffFor(timeframe);
        let pageToken;
        for (let page = 0; page < 2 && uploads; page += 1) {
            const payload = await youtubeRequest('playlistItems', {
                part: 'contentDetails,snippet', playlistId: uploads, maxResults: 50, pageToken
            }, apiKeys);
            for (const entry of payload.items || []) {
                const publishedAt = entry.contentDetails?.videoPublishedAt || entry.snippet?.publishedAt;
                if (cutoff && publishedAt && new Date(publishedAt).getTime() < cutoff) continue;
                if (entry.contentDetails?.videoId) entries.push(entry.contentDetails.videoId);
            }
            pageToken = payload.nextPageToken;
            if (!pageToken) break;
        }
        const videos = [];
        for (let offset = 0; offset < entries.length; offset += 50) {
            const payload = await youtubeRequest('videos', {
                part: 'snippet,statistics,contentDetails', id: entries.slice(offset, offset + 50).join(',')
            }, apiKeys);
            for (const video of payload.items || []) {
                const durationSeconds = parseDuration(video.contentDetails?.duration);
                videos.push({
                    id: video.id,
                    channelId: item.id,
                    channelTitle: item.snippet?.title || null,
                    channelHandle: normalizeHandle(item.snippet?.customUrl || channel.handle),
                    channelThumbnailUrl: item.snippet?.thumbnails?.high?.url || null,
                    title: video.snippet?.title || 'Untitled video',
                    description: video.snippet?.description || '',
                    publishedAt: video.snippet?.publishedAt || null,
                    thumbnailUrl: video.snippet?.thumbnails?.maxres?.url || video.snippet?.thumbnails?.high?.url || null,
                    durationSeconds,
                    views: parseCount(video.statistics?.viewCount) || 0,
                    likes: parseCount(video.statistics?.likeCount) || 0,
                    comments: parseCount(video.statistics?.commentCount) || 0,
                    isShort: durationSeconds <= 60,
                    outlierScore: null,
                    averageViews: null
                });
            }
        }
        const resolved = {
            channelId: item.id,
            handle: normalizeHandle(item.snippet?.customUrl || channel.handle),
            title: item.snippet?.title || channel.title,
            thumbnailUrl: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || channel.thumbnailUrl
        };
        return { channel: resolved, videos };
    }

    async function runResearch(userId, groupId, source, timeframe) {
        if (!['viewstats', 'youtube'].includes(source)) throw new Error('Invalid research source');
        if (!(timeframe in TIMEFRAME_DAYS)) throw new Error('Invalid timeframe');
        const channels = await listChannels(userId, groupId);
        if (!channels.length) return { channels: [], videos: [], errors: [] };
        const apiKeys = source === 'youtube' ? await getYoutubeKeys(userId) : [];
        const outcomes = await mapWithConcurrency(channels, RESEARCH_CONCURRENCY, async channel => {
            try {
                const result = source === 'youtube'
                    ? await youtubeChannelResearch(channel, timeframe, apiKeys)
                    : await viewstatsChannelResearch(channel, timeframe);
                await saveChannelMetadata(result.channel);
                return { result };
            } catch (error) {
                return { error: { channelId: channel.channelId, title: channel.title, message: error.message } };
            }
        });
        const results = outcomes.filter(outcome => outcome.result).map(outcome => outcome.result);
        const errors = outcomes.filter(outcome => outcome.error).map(outcome => outcome.error);
        return {
            channels: results.map(result => result.channel),
            videos: results.flatMap(result => result.videos),
            errors
        };
    }

    async function fetchTranscript(videoId) {
        const normalizedVideoId = String(videoId || '').trim();
        if (!/^[A-Za-z0-9_-]{11}$/.test(normalizedVideoId)) throw new Error('Invalid YouTube video ID');
        let segments;
        try {
            segments = await YoutubeTranscript.fetchTranscript(normalizedVideoId);
        } catch (error) {
            const name = error?.constructor?.name || '';
            if (name === 'YoutubeTranscriptDisabledError' || name === 'YoutubeTranscriptNotAvailableError'
                || name === 'YoutubeTranscriptNotAvailableLanguageError' || name === 'YoutubeTranscriptVideoUnavailableError') {
                throw new Error('No transcript is available for this video');
            }
            if (name === 'YoutubeTranscriptTooManyRequestError') throw new Error('YouTube is rate-limiting transcript requests; try again later');
            throw error;
        }
        const transcript = cleanTranscript((segments || []).map(segment => segment.text).join('\n'));
        if (!transcript) throw new Error('No transcript is available for this video');
        return {
            transcript,
            length: transcript.length,
            hasMore: false
        };
    }

    async function saveYoutubeKeys(userId, primary, backup) {
        const values = { user_id: userId, updated_at: new Date().toISOString() };
        if (primary !== undefined) values.youtube_api_key_1 = String(primary || '').trim() || null;
        if (backup !== undefined) values.youtube_api_key_2 = String(backup || '').trim() || null;
        const { error } = await supabase.from('user_settings').upsert(values, { onConflict: 'user_id' });
        if (error) throw error;
    }

    async function getConfig(userId) {
        const keys = await getYoutubeKeys(userId);
        return {
            viewstatsConfigured: Boolean(env.VIEWSTATS_BEARER_TOKEN && env.VIEWSTATS_IV_B64 && env.VIEWSTATS_KEY_B64),
            youtubeKeyCount: keys.length
        };
    }

    return { addChannel, addChannels, createGroup, fetchTranscript, getConfig, listChannels, listGroups, removeChannel, removeGroup, renameGroup, resolveViaViewstats, runResearch, saveYoutubeKeys, viewstatsRequest };
}

export const researchUtils = { cleanTranscript, normalizeHandle, normalizeIdentifier, parseDuration };
