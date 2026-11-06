import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';

export type VisualFilterType = 'none' | 'vibrant' | 'dark' | 'warm' | 'cool';

interface VisualFilterPreviewProps {
    filterType: VisualFilterType;
}

export const VisualFilterPreview: React.FC<VisualFilterPreviewProps> = ({ filterType }) => {
    const [showOriginal, setShowOriginal] = useState(false);

    // Sample S3 clips (Cooking, Satisfying)
    const CLIPS = [
        'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com/Clips/Satisfying/043xj2Ys.mp4',
        'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com/Clips/Satisfying/06cpZQME.mp4',
        'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com/Clips/Satisfying/08iLsmft.mp4',
        'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com/Clips/Satisfying/09yMHXBR.mp4',
        'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com/Clips/Satisfying/0A7d0zBz.mp4',
    ];

    const [currentClipIndex, setCurrentClipIndex] = useState(0);

    const handleNextClip = (e: React.MouseEvent) => {
        e.stopPropagation();
        setCurrentClipIndex((prev) => (prev + 1) % CLIPS.length);
    };

    // CSS Filters matching VisualFilterContainer.tsx logic (Subtle versions)
    const getFilterStyle = (type: VisualFilterType) => {
        switch (type) {
            case 'vibrant': return 'contrast(1.2) saturate(1.5) brightness(1.05)';
            case 'dark': return 'contrast(1.25) saturate(0.9) brightness(0.9) sepia(0.2)';
            case 'warm': return 'sepia(0.4) saturate(1.4) contrast(1.1) brightness(1.05)';
            case 'cool': return 'hue-rotate(-15deg) saturate(1.2) contrast(1.1) brightness(1.1)';
            default: return 'none';
        }
    };

    const activeFilter = getFilterStyle(filterType);

    return (
        <Card className="bg-black border-[#3A3A3A] overflow-hidden">
            <div className="relative aspect-[9/16] w-full group">
                {/* Image Layer */}
                <video
                    key={CLIPS[currentClipIndex]} // Force reload on change
                    className="absolute inset-0 w-full h-full object-cover transition-all duration-300"
                    src={CLIPS[currentClipIndex]}
                    autoPlay
                    muted
                    loop
                    playsInline
                    style={{
                        filter: showOriginal ? 'none' : activeFilter
                    }}
                />

                {/* Controls Overlay */}
                <div className="absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    {/* Compare Button */}
                    <Button
                        variant="secondary"
                        size="sm"
                        className="bg-black/50 hover:bg-black/70 text-white backdrop-blur-md w-32"
                        onMouseDown={() => setShowOriginal(true)}
                        onMouseUp={() => setShowOriginal(false)}
                        onMouseLeave={() => setShowOriginal(false)}
                        onTouchStart={() => setShowOriginal(true)}
                        onTouchEnd={() => setShowOriginal(false)}
                    >
                        {showOriginal ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                        {showOriginal ? 'Original' : 'Hold Compare'}
                    </Button>

                    {/* Shuffle Clip Button */}
                    <Button
                        variant="secondary"
                        size="sm"
                        className="bg-black/50 hover:bg-black/70 text-white backdrop-blur-md w-32"
                        onClick={handleNextClip}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                        New Clip
                    </Button>
                </div>

                {/* Label */}
                <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white backdrop-blur-sm pointer-events-none">
                    {showOriginal ? 'Original' : `Filter: ${filterType}`}
                </div>
            </div>
        </Card>
    );
};
