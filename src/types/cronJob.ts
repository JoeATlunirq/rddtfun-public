export interface CronJob {
    id: string;
    user_id: string;
    name: string;
    schedule: string; // cron expression
    enabled: boolean;
    profile_id: string | null;
    algorithm_type: 'random' | 'top_videos';
    script_mode: 'w4w' | 'claude_remake';
    algorithm_config: AlgorithmConfig;
    claude_prompt: string | null;
    videos_per_run: number;
    telegram_notifications: boolean;
    last_run: string | null;
    next_run: string | null;
    created_at: string;
    updated_at: string;
    // Joined data
    channel_profiles?: {
        id: string;
        name: string;
        image_url: string | null;
    } | null;
}

export interface AlgorithmConfig {
    channelHandles: string[];
    channelIds: string[];
    timeFrame: '7d' | '14d' | '28d' | '90d' | '365d';
    minViews: number;
    maxVideos: number;
    source: 'viewstats' | 'youtube';
}

export interface CronJobExecution {
    id: string;
    cron_job_id: string;
    status: 'pending' | 'researching' | 'generating_script' | 'rendering' | 'success' | 'failed';
    started_at: string;
    completed_at: string | null;
    videos_generated: number;
    source_video: SourceVideo | null;
    generated_hook: string | null;
    generated_script: string | null;
    video_id: string | null;
    video_url: string | null;
    error_message: string | null;
    logs: ExecutionLog[];
    created_at: string;
    metadata?: ExecutionMetadata | null;
    // Joined data
    research_results?: ResearchResult[];
}

export interface ExecutionMetadata {
    method: string;
    algorithm_type: string;
    source_video?: {
        video_id: string;
        channel: string;
        title: string;
        views: number;
    } | null;
    profile?: {
        id: string;
        name: string;
    };
    presets?: {
        caption: string | null;
        hook_style: string | null;
        audio: string | null;
    };
    settings?: {
        voice_id: string;
        font: string;
        subtitle_size: number;
        target_duration: number | null;
        add_background_music: boolean;
    };
    detected_gender: string;
    generated_at: string;
}

export interface SourceVideo {
    title: string;
    channelTitle: string;
    videoId: string;
    viewCount: number;
    likeCount?: number;
    publishedAt: string;
    thumbnailUrl?: string;
    duration?: string;
}

export interface ExecutionLog {
    timestamp: string;
    message: string;
}

export interface ResearchResult {
    id: string;
    execution_id: string;
    trendy_job_id: string;
    videos: SourceVideo[];
    total_videos: number;
    created_at: string;
}

export interface CronJobFormData {
    name: string;
    schedule: string;
    enabled: boolean;
    profile_id: string | null;
    algorithm_type: 'random' | 'top_videos';
    script_mode: 'w4w' | 'claude_remake';
    algorithm_config: AlgorithmConfig;
    claude_prompt: string;
    videos_per_run: number;
    telegram_notifications: boolean;
}

// Common cron schedule presets
export const SCHEDULE_PRESETS = [
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 2 hours', value: '0 */2 * * *' },
    { label: 'Every 4 hours', value: '0 */4 * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Every 12 hours', value: '0 */12 * * *' },
    { label: 'Once daily (midnight)', value: '0 0 * * *' },
    { label: 'Once daily (noon)', value: '0 12 * * *' },
    { label: 'Twice daily (8am & 8pm)', value: '0 8,20 * * *' },
    { label: 'Three times daily', value: '0 8,14,20 * * *' },
];

export const ALGORITHM_TYPES = [
    {
        value: 'random',
        label: 'Random Selection',
        description: 'Randomly select from qualifying videos'
    },
    {
        value: 'top_videos',
        label: 'Top Performing',
        description: 'Select the highest viewed video'
    },
];

export const SCRIPT_MODES = [
    {
        value: 'w4w',
        label: 'Word for Word',
        description: 'Use the original script directly - no AI modification'
    },
    {
        value: 'claude_remake',
        label: 'Claude Remake',
        description: 'Use Claude AI to rewrite the script in your style'
    },
];

export const TIMEFRAME_OPTIONS = [
    { value: '7d', label: 'Last 7 days' },
    { value: '14d', label: 'Last 14 days' },
    { value: '28d', label: 'Last 28 days' },
    { value: '90d', label: 'Last 90 days' },
    { value: '365d', label: 'All Time' },
];

export const DEFAULT_CLAUDE_PROMPT = `You are a script writer for viral Reddit-style short form video content.

Based on the source video, create a new engaging script. Your response MUST include:

{HOOK}
Your attention-grabbing hook here (1-2 sentences)

{BODY}
Your main script content here (3-6 sentences)

The content should be conversational, authentic, and suitable for a 30-60 second video.`;

export const DEFAULT_ALGORITHM_CONFIG: AlgorithmConfig = {
    channelHandles: [],
    channelIds: [],
    timeFrame: '28d',
    minViews: 10000,
    maxVideos: 10,
    source: 'viewstats',
};
