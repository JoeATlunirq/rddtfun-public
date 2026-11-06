export interface VideoCompositionSchema {
    channelName: string;
    channelImage: string;
    hookText: string;
    audioUrl: string;
    audioDurationInSeconds: number;
    hook_animation_type?: 'fall' | 'float';
    subtitleText: string;
    scriptAudioUrl: string;
    scriptAudioDurationInSeconds: number;
    wordTimings: Array<{
        text: string;
        startFrame: number;
        endFrame: number;
        color?: string;
    }>;
    totalDurationInFrames: number;
    backgroundVideoPath: string[] | Array<{
        path: string;
        durationInFrames: number;
        durationInSeconds?: number;
    }> | string;
    assetUrls?: {
        badge?: string;
        bubble?: string;
        share?: string;
    };
    bucketName?: string;
    bucketRegion?: string;
    subtitle_size?: number;
    stroke_size?: number;
    has_background_music?: boolean;
    background_music_volume?: number;
    hookStyle?: {
        titleColor: string;
        backgroundColor: string;
        font: string;
        borderRadius: number;
        hookTopPosition?: boolean;
    } | null;
}
