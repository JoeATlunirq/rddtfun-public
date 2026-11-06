/// <reference lib="dom" />
import React from 'react';
import { OffthreadVideo, Series } from 'remotion';

interface VideoInfo {
    path: string;
    durationInFrames: number;
    durationInSeconds: number;
}

interface Props {
    backgroundVideoPath: string[] | VideoInfo[] | string;
    volume?: number;
}

export const BackgroundVideo: React.FC<Props> = ({ backgroundVideoPath, volume = 0 }) => {
    // Debug logging
    console.log('==== BACKGROUND VIDEO COMPONENT ====');
    console.log('backgroundVideoPath received:', backgroundVideoPath);
    console.log('backgroundVideoPath type:', typeof backgroundVideoPath);
    console.log('backgroundVideoPath is array:', Array.isArray(backgroundVideoPath));
    console.log('backgroundVideoPath length:', Array.isArray(backgroundVideoPath) ? backgroundVideoPath.length : 'N/A');

    // Handle both string and array formats for backward compatibility
    const videoArray = Array.isArray(backgroundVideoPath)
        ? backgroundVideoPath
        : [backgroundVideoPath];

    console.log('videoArray after conversion:', videoArray);
    console.log('videoArray length:', videoArray.length);

    // Extract video info if it's in the format we expect
    const videos: Array<{ path: string, durationInFrames?: number }> = videoArray.map((item, index) => {
        console.log(`Processing video item ${index}:`, item);
        // Check if the item is a string or an object with path and durationInFrames
        if (typeof item === 'string') {
            // If it's just a string path, we don't have duration info
            return { path: item };
        } else if (typeof item === 'object' && item !== null && 'path' in item) {
            // If it's an object with path and durationInFrames, use those
            return {
                path: item.path as string,
                durationInFrames: (item as VideoInfo).durationInFrames
            };
        }
        // Fallback to just using the item as a path
        return { path: String(item) };
    });

    console.log('Final videos array:', videos);
    console.log('Number of videos to render:', videos.length);

    return (
        <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            overflow: 'hidden',
        }}>
            <Series>
                {videos.map((video, index) => (
                    <Series.Sequence
                        key={`${video.path}-${index}`}
                        durationInFrames={video.durationInFrames || 300} // Default to 10 seconds (at 30fps) if no duration provided
                    >
                        {/* Wrapper div to ensure Transform/Filter applies reliably */}
                        <div style={{
                            width: '100%',
                            height: '100%',
                            position: 'absolute',
                            transform: 'scaleX(-1)', // Mirror
                            filter: 'saturate(1.27) brightness(0.87) contrast(1.14) sepia(0.27)', // Color grading +35%
                        }}>
                            <OffthreadVideo
                                src={video.path}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                }}
                                volume={volume}
                                toneMapped={false}
                            />
                        </div>
                    </Series.Sequence>
                ))}
            </Series>
        </div>
    );
};
