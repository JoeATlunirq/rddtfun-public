import React from 'react';
import { AbsoluteFill, Series, Audio, useVideoConfig } from 'remotion';
import { HookVideo } from './hooks/HookVideo';
import { FloatingHookVideo } from './hooks/FloatingHookVideo';
import { SubtitleComposition } from './subtitles/SubtitleComposition';
import { BackgroundVideo } from './BackgroundVideo';
import backgroundMusic from '../assets/music/bgmusic.mp3';
import { VisualFilterContainer, VisualFilterType } from './filters/VisualFilterContainer';

interface WordTiming {
    text: string;
    startFrame: number;
    endFrame: number;
    color?: string;
}

interface VideoInfo {
    path: string;
    durationInFrames: number;
    durationInSeconds: number;
}

interface Props {
    // Hook props
    channelName?: string;
    channelImage?: string;
    hookText?: string;
    audioUrl?: string;
    audioDurationInSeconds?: number;
    hook_animation_type?: 'fall' | 'float';

    // Subtitle props
    subtitleText: string;
    scriptAudioUrl: string;
    scriptAudioDurationInSeconds: number;
    wordTimings?: WordTiming[];
    framesPerWord?: number;
    totalDurationInFrames: number;
    subtitle_size?: number;
    stroke_size?: number;

    // Font props
    font?: string;
    fontUrl?: string;

    // Background video props
    backgroundVideoPath: string[] | VideoInfo[] | string;
    has_background_music?: boolean;
    backgroundMusicUrl?: string;
    background_music_volume?: number;

    // Asset URLs for HookVideo
    assetUrls?: {
        badge?: string;
        bubble?: string;
        share?: string;
    };

    // Bucket information for S3 assets
    bucketName?: string;
    bucketRegion?: string;

    // Single Block Props
    isSingleAudioBlock?: boolean;
    hookSplitTime?: number;
    hookStyle?: {
        titleColor: string;
        backgroundColor: string;
        font: string;
        borderRadius: number;
        hookTopPosition?: boolean;
    } | null | undefined;

    // New prop for hook captions
    hookWordTimings?: WordTiming[];

    // Caption Animation
    captionAnimation?: 'scale' | 'slide' | 'fade' | 'motion-blur' | 'none';

    // Visual Filter
    visual_filter?: VisualFilterType;
}

export const MainComposition: React.FC<Props> = ({
    // Hook props
    channelName = "Default Channel",
    channelImage = "",
    hookText = "Default Hook",
    audioUrl = "",
    audioDurationInSeconds = 3,
    hook_animation_type = 'fall',

    // Subtitle props
    subtitleText,
    scriptAudioUrl,
    scriptAudioDurationInSeconds,
    wordTimings = [],
    framesPerWord = 30,
    totalDurationInFrames,
    subtitle_size = 64,
    stroke_size = 8,
    captionAnimation = 'scale',

    // Font props
    font = "Jellee",
    fontUrl,

    // Background video props
    backgroundVideoPath,
    has_background_music = false,
    backgroundMusicUrl = "",
    background_music_volume = 0.015,

    // Asset URLs
    assetUrls = {},

    // Bucket information for S3 assets
    bucketName,
    bucketRegion,

    // Single Block Props
    isSingleAudioBlock = false,
    hookSplitTime = 0,
    hookStyle = null,

    // Hook captions
    hookWordTimings = [],

    // Visual Filter
    visual_filter = 'none'
}) => {
    const { fps } = useVideoConfig();
    const scriptDurationInFrames = Math.ceil(scriptAudioDurationInSeconds * fps);
    const hookDurationInFrames = Math.ceil(audioDurationInSeconds * fps);

    // For isSingleAudioBlock mode, word timings are from full audio starting at t=0
    // But the script sequence starts AFTER the hook sequence, so we need to offset the timings
    // Subtract hookSplitTime (in frames) from each word's start/end frame
    const adjustedWordTimings = isSingleAudioBlock && hookSplitTime > 0
        ? wordTimings.map(w => {
            const hookFrameOffset = Math.ceil(hookSplitTime * fps);
            return {
                ...w,
                startFrame: Math.max(0, w.startFrame - hookFrameOffset),
                endFrame: Math.max(0, w.endFrame - hookFrameOffset)
            };
        }).filter(w => w.endFrame > 0) // Remove words that happened during hook section
        : wordTimings;

    // Verify our durations match what we expect
    const calculatedTotalFrames = hookDurationInFrames + scriptDurationInFrames;
    if (Math.abs(calculatedTotalFrames - totalDurationInFrames) > 5) { // Allow small jitter
        console.warn(`Duration mismatch: expected ${totalDurationInFrames} frames but calculated ${calculatedTotalFrames} frames`);
    }

    // Single Block Audio Logic
    const hookAudioProps = isSingleAudioBlock
        ? { startFrom: 0, endAt: Math.ceil((hookSplitTime || audioDurationInSeconds) * fps) }
        : {};

    // For script
    const scriptAudioProps = isSingleAudioBlock
        ? { startFrom: Math.ceil((hookSplitTime || audioDurationInSeconds) * fps) }
        : {};

    // Choose the correct Hook Video component based on animation type
    const HookVideoComponent = hook_animation_type === 'float' ? FloatingHookVideo : HookVideo;

    return (
        <AbsoluteFill style={{ backgroundColor: '#000000' }}>
            <VisualFilterContainer filterType={visual_filter}>
                {/* Background video layer */}
                <BackgroundVideo
                    backgroundVideoPath={backgroundVideoPath}
                    volume={0}
                />

                {/* Background music that spans entire video */}
                {has_background_music && (
                    <Audio
                        src={backgroundMusicUrl || backgroundMusic}
                        volume={background_music_volume}
                        loop
                    />
                )}

                {/* Content layers */}
                <Series>
                    <Series.Sequence durationInFrames={hookDurationInFrames}>
                        <HookVideoComponent
                            channelName={channelName}
                            channelImage={channelImage}
                            hookText={hookText}
                            audioUrl={audioUrl}
                            audioDurationInSeconds={audioDurationInSeconds}
                            assetUrls={assetUrls}
                            bucketName={bucketName}
                            bucketRegion={bucketRegion}
                            font={font}
                            fontUrl={fontUrl}
                            hookStyle={hookStyle || undefined}
                            {...hookAudioProps}
                        />

                        {/* Render Hook Captions if available (for Float mode) */}
                        {hookWordTimings && hookWordTimings.length > 0 && (
                            <SubtitleComposition
                                text={hookText} // Fallback text
                                wordTimings={hookWordTimings}
                                framesPerWord={Math.ceil(hookDurationInFrames / (hookText ? hookText.split(' ').length : 1))}
                                scriptDurationInFrames={hookDurationInFrames}
                                font={font}
                                fontUrl={fontUrl}
                                subtitle_size={subtitle_size}
                                stroke_size={stroke_size}
                                captionAnimation={captionAnimation}
                            />
                        )}
                    </Series.Sequence>
                    <Series.Sequence durationInFrames={scriptDurationInFrames}>
                        <SubtitleComposition
                            text={subtitleText}
                            wordTimings={adjustedWordTimings}
                            framesPerWord={Math.ceil(scriptDurationInFrames / subtitleText.split(' ').length)}
                            scriptDurationInFrames={scriptDurationInFrames}
                            font={font}
                            fontUrl={fontUrl}
                            subtitle_size={subtitle_size}
                            stroke_size={stroke_size}
                            captionAnimation={captionAnimation}
                        />
                        <Audio src={scriptAudioUrl} {...scriptAudioProps} />
                    </Series.Sequence>
                </Series>
            </VisualFilterContainer>
        </AbsoluteFill>
    );
};
