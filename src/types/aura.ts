export type AuraTimeframe = '24h' | '7d' | '30d';

export const AURA_TIMEFRAMES: { value: AuraTimeframe; label: string }[] = [
    { value: '24h', label: 'Daily' },
    { value: '7d', label: 'Weekly' },
    { value: '30d', label: 'Monthly' },
];

export interface AuraChannel {
    channelId: string;
    handle: string;
    title: string;
    thumbnailUrl: string | null;
}

export interface AuraEntry extends AuraChannel {
    rank: number;
    previousRank: number | null;
    rankChange: number;
    score: number;
    totalSubscribers: number;
    totalViews: number;
    viewsGained: number;
    subsGained: number;
    videosPublished: number;
    avgViewsPerVideo: number;
    engagementRate: number;
    dailyViews: { date: string; views: number }[];
    fetchedAt: string;
}

export interface AuraLeaderboard {
    timeframe: AuraTimeframe;
    entries: AuraEntry[];
    errors: { channelId: string; handle: string; message: string }[];
    channelCount: number;
    lastUpdated: string;
}
