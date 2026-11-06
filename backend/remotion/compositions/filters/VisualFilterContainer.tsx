import React from 'react';
import { AbsoluteFill, useVideoConfig, useCurrentFrame, random } from 'remotion';

export type VisualFilterType = 'none' | 'crt' | 'vhs' | 'old-film' | 'vibrant' | 'dark' | 'warm' | 'cool';

interface Props {
    children: React.ReactNode;
    filterType?: VisualFilterType;
}

export const VisualFilterContainer: React.FC<Props> = ({ children, filterType = 'none' }) => {
    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();

    if (filterType === 'none') {
        return <>{children}</>;
    }

    return (
        <AbsoluteFill>
            {/* Main Content Level */}
            <AbsoluteFill style={{
                filter: getBaseFilter(filterType),
            }}>
                {children}
            </AbsoluteFill>

            {/* Overlay Level */}
            {filterType === 'crt' && <CRTOverlay width={width} height={height} />}
            {filterType === 'vhs' && <VHSOverlay frame={frame} />}
            {filterType === 'old-film' && <OldFilmOverlay frame={frame} />}
        </AbsoluteFill>
    );
};

const getBaseFilter = (type: VisualFilterType): string => {
    switch (type) {
        case 'crt': // Legacy mapping if needed, or mapped to vibrant? Let's keep distinct.
            return 'contrast(1.2) brightness(1.1) saturate(1.2)';
        case 'vibrant': // Explicit support if type added
            return 'contrast(1.2) saturate(1.5) brightness(1.05)';
        case 'dark':
            return 'contrast(1.25) saturate(0.9) brightness(0.9) sepia(0.2)';
        case 'warm':
            return 'sepia(0.4) saturate(1.4) contrast(1.1) brightness(1.05)';
        case 'cool':
            return 'hue-rotate(-15deg) saturate(1.2) contrast(1.1) brightness(1.1)';
        case 'vhs':
            return 'contrast(1.4) saturate(1.4) brightness(1.1) sepia(0.2)';
        case 'old-film':
            return 'sepia(0.8) contrast(1.1) brightness(0.9)';
        default:
            return 'none';
    }
}

const CRTOverlay: React.FC<{ width: number, height: number }> = ({ width, height }) => (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {/* Scanlines */}
        <div style={{
            position: 'absolute',
            inset: 0,
            background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 2px, transparent 4px)',
            backgroundSize: '100% 4px',
            pointerEvents: 'none',
        }} />
        {/* Vignette */}
        <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle, transparent 60%, rgba(0,0,0,0.4) 100%)',
            pointerEvents: 'none',
        }} />
        {/* Subtle RGB Split simulation via slight overlay or mix-blend-mode? 
             Complex to do purely overlay. We'll stick to styles for now.
         */}
    </AbsoluteFill>
);

const VHSOverlay: React.FC<{ frame: number }> = ({ frame }) => {
    // Random noise offset
    const noiseX = random(frame) * 100;
    const noiseY = random(frame + 100) * 100;

    return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
            {/* Noise Texture (Css Pattern) */}
            <div style={{
                position: 'absolute',
                inset: 0,
                opacity: 0.10,
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
                transform: `translate(${noiseX % 10}px, ${noiseY % 10}px)`,
                filter: 'contrast(150%) brightness(100%)',
            }} />
            {/* Tracking Lines (occasional) */}
            {frame % 120 > 115 && (
                <div style={{
                    position: 'absolute',
                    bottom: '10%',
                    left: 0,
                    right: 0,
                    height: '2px',
                    background: 'rgba(255,255,255,0.5)',
                    boxShadow: '0 0 10px white',
                    opacity: 0.5
                }} />
            )}
        </AbsoluteFill>
    );
};

const OldFilmOverlay: React.FC<{ frame: number }> = ({ frame }) => {
    return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
            {/* Dust/Scratches */}
            <div style={{
                position: 'absolute',
                inset: 0,
                opacity: 0.15,
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
            }} />
            {/* Flicker */}
            <div style={{
                position: 'absolute',
                inset: 0,
                background: 'black',
                opacity: random(frame) * 0.1,
            }} />
        </AbsoluteFill>
    );
}
