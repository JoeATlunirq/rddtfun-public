import React, { useEffect, useState } from 'react';
import { AbsoluteFill, delayRender, continueRender } from 'remotion';
import { SubtitleCard } from './SubtitleCard';

// S3 Asset Base URL
const S3_BUCKET_URL = 'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com';

// Font file mapping - MATCHING PREVIEW EXACTLY
const fontFilesMap: Record<string, string> = {
    'Roboto': 'Fonts/Roboto.woff2',
    'Montserrat': 'Fonts/Montserrat.woff2',
    'Fredoka': 'Fonts/Fredoka.woff2',
    'Komika Axis': 'Fonts/Roboto.woff2',
    'Lilita One': 'Fonts/LilitaOne.woff2',
    'Jellee': 'Fonts/Jellee-Roman.ttf',
    'Ubuntu': 'Fonts/Ubuntu.woff2',
};

interface WordTiming {
    text: string;
    startFrame: number;
    endFrame: number;
    color?: string;
}

interface Props {
    text: string;
    wordTimings?: WordTiming[];
    framesPerWord?: number;
    scriptDurationInFrames?: number;
    font?: string;
    fontUrl?: string;
    subtitle_size?: number;
    stroke_size?: number;
    captionAnimation?: 'scale' | 'slide' | 'fade' | 'motion-blur' | 'none';
}

export const SubtitleComposition: React.FC<Props> = ({
    text,
    wordTimings = [],
    framesPerWord = 30,
    scriptDurationInFrames,
    font = 'Jellee',
    fontUrl,
    subtitle_size = 64,
    stroke_size = 8,
    captionAnimation = 'scale'
}) => {
    const [handle] = useState(() => delayRender('Loading font: ' + font));

    // ... (useEffect hook remains same, skipped for brevity in replace tool but ensuring context)

    // Centralized font loading for the entire script - MATCHING PREVIEW EXACTLY
    useEffect(() => {
        const effectiveFont = font || 'Roboto';
        const fontPath = fontFilesMap[effectiveFont] || 'Fonts/Roboto-Bold.ttf';
        const urlToLoad = fontUrl || `${S3_BUCKET_URL}/${fontPath}`;

        console.log(`[Script] Loading font: ${effectiveFont} from ${urlToLoad}`);

        const loadFontAsync = async () => {
            try {
                const face = new FontFace(effectiveFont, `url(${urlToLoad})`, { weight: '700' });
                const loaded = await face.load();
                (document.fonts as any).add(loaded);
                console.log(`[Script] SUCCESS: ${effectiveFont} loaded.`);
                continueRender(handle);
            } catch (e) {
                console.error(`[Script] FAILED loading ${effectiveFont}:`, e);
                // Fallback to avoid hanging
                continueRender(handle);
            }
        };

        loadFontAsync();
    }, [font, fontUrl, handle]);

    const OVERLAP_FRAMES = 5;

    // If we have word timings, render all SubtitleCards
    if (wordTimings.length > 0) {
        return (
            <AbsoluteFill style={{
                background: 'transparent',
            }}>
                {wordTimings.map((word, index) => {
                    const originalDuration = word.endFrame - word.startFrame;
                    // Extend duration for 'motion-blur' to allow exit animation overlapping next word
                    const renderDuration = captionAnimation === 'motion-blur' ? originalDuration + OVERLAP_FRAMES : originalDuration;

                    return (
                        <SubtitleCard
                            key={index}
                            text={word.text}
                            startFrame={word.startFrame}
                            duration={renderDuration}
                            color={word.color}
                            font={font}
                            fontUrl={fontUrl}
                            subtitle_size={subtitle_size}
                            stroke_size={stroke_size}
                            animationType={captionAnimation}
                        />
                    );
                })}
            </AbsoluteFill>
        );
    }

    // Fallback to evenly spaced words
    const words = text.split(' ');
    const duration = scriptDurationInFrames || words.length * framesPerWord;
    const actualFramesPerWord = Math.ceil(duration / words.length);

    return (
        <AbsoluteFill style={{
            background: 'transparent',
        }}>
            {words.map((word, index) => (
                <SubtitleCard
                    key={index}
                    text={word}
                    startFrame={index * actualFramesPerWord}
                    duration={actualFramesPerWord}
                    font={font}
                    fontUrl={fontUrl}
                    subtitle_size={subtitle_size}
                    stroke_size={stroke_size}
                    animationType={captionAnimation}
                />
            ))}
        </AbsoluteFill>
    );
};
