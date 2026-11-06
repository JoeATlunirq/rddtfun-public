import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAuraScore, normalizeAuraHandle, summarizeDailyStats } from '../services/auraService.js';

test('normalizes Aura handle input', () => {
    assert.equal(normalizeAuraHandle('MrBeast'), '@MrBeast');
    assert.equal(normalizeAuraHandle(' @MrBeast '), '@MrBeast');
    assert.equal(normalizeAuraHandle('https://www.youtube.com/@MrBeast/shorts'), '@MrBeast');
    assert.equal(normalizeAuraHandle('UCX6OQ3DkcsbYNE6H8uQQuVA'), 'UCX6OQ3DkcsbYNE6H8uQQuVA');
    assert.throws(() => normalizeAuraHandle(''), /Enter a YouTube/);
});

test('summarizes only the most recent days of ViewStats records', () => {
    const records = [
        { date: '2026-10-20', viewCountDelta: 100, subscriberCountDelta: 1, videoCountDelta: 1, viewCount: 1000, subscriberCount: 50 },
        { date: '2026-10-22', viewCountDelta: 300, subscriberCountDelta: 3, videoCountDelta: 2, viewCount: 1500, subscriberCount: 54 },
        { date: '2026-10-21', viewCountDelta: 200, subscriberCountDelta: 2, videoCountDelta: 0, viewCount: 1200, subscriberCount: 51 }
    ];
    const day = summarizeDailyStats(records, 1);
    assert.equal(day.viewsGained, 300);
    assert.equal(day.totalSubscribers, 54);
    assert.equal(day.avgViewsPerVideo, 150);
    const week = summarizeDailyStats(records, 7);
    assert.equal(week.viewsGained, 600);
    assert.equal(week.videosPublished, 3);
    assert.deepEqual(week.dailyViews.map(d => d.date), ['2026-10-20', '2026-10-21', '2026-10-22']);
});

test('Aura score stays within 0-100 and rewards views', () => {
    const base = { subsGained: 0, totalSubscribers: 1000, engagementRate: 0, videosPublished: 1, avgViewsPerVideo: 0 };
    const low = calculateAuraScore({ ...base, viewsGained: 1_000 }, '24h');
    const high = calculateAuraScore({ ...base, viewsGained: 5_000_000, avgViewsPerVideo: 5_000_000, subsGained: 10_000 }, '24h');
    assert.ok(low >= 0 && low < high);
    assert.ok(high <= 100);
});
