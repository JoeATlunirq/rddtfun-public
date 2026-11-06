import { useCurrentFrame, spring, useVideoConfig, interpolate } from 'remotion';
import React, { useMemo } from 'react';

interface Props {
    text: string;
    startFrame: number;
    duration: number;
    color?: string;
    font?: string;
    fontUrl?: string;
    subtitle_size?: number;
    stroke_size?: number;
    animationType?: 'scale' | 'slide' | 'fade' | 'motion-blur' | 'none';
}

/**
 * SubtitleCard component - FULLY DETERMINISTIC
 * 
 * Following Remotion's flickering docs:
 * 1. Component displays same visual when called multiple times for same frame
 * 2. Component doesn't rely on frames being rendered in order
 * 3. Component doesn't animate when video is paused
 * 4. All calculations are purely based on useCurrentFrame()
 * 
 * NOTE: delayRender is NOT used here because:
 * - Fonts are loaded at SubtitleComposition level
 * - This is pure text rendering, no async data
 * - Having delayRender per word causes hundreds of blocking calls
 */
export const SubtitleCard: React.FC<Props> = ({
    text,
    startFrame,
    duration,
    color = '#FFFFFF',
    font = 'Roboto',
    fontUrl,
    subtitle_size = 64,
    stroke_size = 8,
    animationType = 'scale'
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    // ALL calculations memoized and derived purely from frame number
    const { isVisible, animatedScale, animatedScaleX, animatedScaleY, animatedTranslateY, opacity, filter } = useMemo(() => {
        const relativeFrame = frame - startFrame;
        const visible = relativeFrame >= 0 && relativeFrame < duration;

        if (!visible) {
            return { isVisible: false, animatedScale: 1, animatedTranslateY: 0, opacity: 0, filter: 'none' };
        }

        let scaleVal = 1;
        let animatedScaleX = 1;
        let animatedScaleY = 1;
        let translateYVal = 0;
        let opacityVal = 1;
        let filterVal = 'none';

        if (animationType === 'scale') {
            // Refined subtler scale: 0.8 -> 1.05 -> 1.0
            const progress = interpolate(relativeFrame, [0, 4, 8], [0.8, 1.05, 1], {
                extrapolateRight: 'clamp',
            });
            scaleVal = progress;
            opacityVal = interpolate(relativeFrame, [0, 3], [0, 1], { extrapolateRight: 'clamp' });
        } else if (animationType === 'slide') {
            // Deprecated in favor of Blur, but supported for legacy
            translateYVal = interpolate(relativeFrame, [0, 5], [20, 0], { extrapolateRight: 'clamp' });
        } else if (animationType === 'motion-blur') {
            const OVERLAP_FRAMES = 5;
            const exitStart = duration - OVERLAP_FRAMES;

            if (relativeFrame >= exitStart) {
                // Exit Morph: Vertical Stretch + Blur Out
                const exitProgress = relativeFrame - exitStart;
                const blurOut = interpolate(exitProgress, [0, OVERLAP_FRAMES], [0, 10], { extrapolateRight: 'clamp' });

                // Stretch vertically (1 -> 2.5), compress horizontally (1 -> 0.8)
                animatedScaleY = interpolate(exitProgress, [0, OVERLAP_FRAMES], [1, 2.5], { extrapolateRight: 'clamp' });
                animatedScaleX = interpolate(exitProgress, [0, OVERLAP_FRAMES], [1, 0.8], { extrapolateRight: 'clamp' });

                // Fade out
                const opacityOut = interpolate(exitProgress, [0, 2, OVERLAP_FRAMES], [1, 1, 0], { extrapolateRight: 'clamp' });

                filterVal = `blur(${blurOut}px)`;
                opacityVal = opacityOut;
                // scaleVal remains 1 (base scale), we modification via ScaleX/Y
            } else {
                // Enter Morph: Unstretch + Blur In
                // Start stretched (3.0, 0.6) -> End normal (1, 1)
                // Fast snap (frames 0-3)
                animatedScaleY = interpolate(relativeFrame, [0, 4], [3, 1], { extrapolateRight: 'clamp' });
                animatedScaleX = interpolate(relativeFrame, [0, 4], [0.6, 1], { extrapolateRight: 'clamp' });

                const blurAmount = interpolate(relativeFrame, [0, 3], [10, 0], { extrapolateRight: 'clamp' });
                filterVal = `blur(${blurAmount}px)`;

                opacityVal = interpolate(relativeFrame, [0, 2], [0, 1], { extrapolateRight: 'clamp' });
            }
        } else if (animationType === 'fade') {
            // Fade in over 3 frames
            opacityVal = interpolate(relativeFrame, [0, 3], [0, 1], {
                extrapolateRight: 'clamp',
            });
        }

        return {
            isVisible: true,
            animatedScale: scaleVal,
            animatedScaleX,
            animatedScaleY,
            animatedTranslateY: translateYVal,
            opacity: opacityVal,
            filter: filterVal
        };
    }, [frame, startFrame, duration, fps, animationType]);

    // Container style - memoized for consistent rendering
    const containerStyle: React.CSSProperties = useMemo(() => ({
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        pointerEvents: 'none',
    }), [opacity]);

    // Text style - memoized for consistent rendering
    const textStyle: React.CSSProperties = useMemo(() => ({
        fontFamily: `"${font}", sans-serif`,
        fontSize: `${subtitle_size}px`,
        fontWeight: 700,
        color,
        margin: 0,
        WebkitTextStroke: `${stroke_size * 2}px black`,
        paintOrder: 'stroke fill',
        position: 'relative',
        transform: `scale(${animatedScale}) translateY(${animatedTranslateY}px) ${animationType === 'motion-blur' ? `scaleY(${animatedScaleY}) scaleX(${animatedScaleX})` : ''}`,
        textAlign: 'center',
        padding: '0 40px',
        filter,
    }), [font, subtitle_size, color, stroke_size, animatedScale, animatedScaleX, animatedScaleY, animatedTranslateY, filter]);

    return (
        <div style={containerStyle}>
            <h1 style={textStyle}>
                {text}
            </h1>
        </div>
    );
};
