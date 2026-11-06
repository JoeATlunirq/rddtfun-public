import { useEffect, useState, type CSSProperties } from 'react';
import { fontUrl, FONT_URLS, NATIVE_BOLD_FONTS, paletteColorAt, type CaptionAnimation, type CaptionLookFields } from '@/lib/videoStyles';

// We can move this to types/channel.ts later
export interface CaptionStyle extends CaptionLookFields {
    font: string;
    style: 'single' | 'grouped';
    subtitle_size: number;
    stroke_size: number;
    hook_animation_type?: 'fall' | 'float'; // Optional now
    color?: string; // Future proofing
    rainbow_text?: boolean; // Enable random colorful text
    caption_animation_type?: CaptionAnimation;
    visual_filter?: 'none' | 'vibrant' | 'dark' | 'warm' | 'cool';
}

const ANIMATION_CSS: Record<string, string> = {
    'scale': 'scale-pop 0.27s ease-out forwards',
    'pop': 'punch-pop 0.2s ease-out forwards',
    'bounce': 'bounce-up 0.23s ease-out forwards',
    'grow': 'slow-grow 0.6s linear forwards',
    // Blur swap: incoming group sharpens over 6 frames at 30fps (the blur-out of the old group is video-only)
    'blur-swap': 'blur-swap 0.2s steps(6, jump-none) forwards',
    // CapCut slide crossfade: 3 frames at 30fps, stepped like the renderer
    'blur-in': 'smear-in 0.1s steps(3, jump-none) forwards',
    'motion-blur': 'stretch-in 0.133s linear forwards',
    'slide': 'slide-up 0.17s ease-out forwards',
    'fade': 'fade-in 0.1s ease-out forwards',
    'punch': 'zoom-punch 0.13s ease-out forwards',
    'drop': 'drop-in 0.27s ease-out forwards',
    'shake': 'shake 0.33s linear forwards',
};

// Outgoing word after the cut, for animations where old and new words mesh (same timing as the
// renderer's cue overlap): CapCut slide keeps the old word for 1 frame, stretch motion blur for 5.
const EXIT_CSS: Record<string, string> = {
    'blur-in': 'smear-out 0.067s steps(2, jump-none) forwards',
    'motion-blur': 'stretch-out 0.167s linear forwards',
};

const SHADOW_CSS = (shadow: string | undefined, px: number, color: string) => {
    if (shadow === 'hard') return `${px * 0.06}px ${px * 0.07}px 0 rgba(0,0,0,0.9)`;
    if (shadow === 'soft') return `0 ${px * 0.03}px ${px * 0.18}px rgba(0,0,0,0.85), 0 ${px * 0.03}px ${px * 0.18}px rgba(0,0,0,0.85)`;
    if (shadow === 'neon') return `0 0 ${px * 0.1}px rgba(0,0,0,0.55), 0 0 ${px * 0.22}px ${color}, 0 0 ${px * 0.22}px ${color}`;
    return 'none';
};

/** Mix a hex color toward white (neon tube core), like the renderer. */
function lighten(color: string, amount: number) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return color;
    const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    const channel = (i: number) => {
        const v = parseInt(hex.slice(i, i + 2), 16);
        return Math.round(v + (255 - v) * amount);
    };
    return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

const POSITION_TOP: Record<string, string> = { center: '50%', upper: '36%', lower: '68%' };

function applyCase(text: string, textCase?: string) {
    if (textCase === 'upper') return text.toUpperCase();
    if (textCase === 'lower') return text.toLowerCase();
    return text;
}

const sampleText = "Previewing The Animation Style";
const previewWords = sampleText.split(' ');

interface CaptionPreviewProps {
    style: CaptionStyle;
    text?: string;
}

export function CaptionPreview({ style, text = "Caption Preview" }: CaptionPreviewProps) {
    // Font loading logic (Restored to fix font not being respected)
    useEffect(() => {
        const effectiveFont = style?.font && FONT_URLS[style.font] ? style.font : 'Roboto';
        const fontUrlToLoad = fontUrl(effectiveFont);

        const loadFont = async () => {
            try {
                const customFontFace = new FontFace(effectiveFont, `url(${fontUrlToLoad})`, { weight: '700' });
                const loadedFace = await customFontFace.load();
                (document.fonts as any).add(loadedFace);
                console.log(`[Preview] ${effectiveFont} font loaded.`);
            } catch (error) {
                console.error(`[Preview] Error loading ${effectiveFont} font:`, error);
            }
        };
        loadFont();
    }, [style.font]); // Dependency array ensures font loads when style.font changes

    // Word cycling logic for "Live" preview (tick counts word changes so the outgoing word remounts)
    const [{ currentWordIndex, previousWordIndex, tick }, setWords] = useState({ currentWordIndex: 0, previousWordIndex: -1, tick: 0 });

    useEffect(() => {
        const interval = setInterval(() => {
            setWords(w => ({ currentWordIndex: (w.currentWordIndex + 1) % previewWords.length, previousWordIndex: w.currentWordIndex, tick: w.tick + 1 }));
        }, 600); // Change word every 600ms (approx reading speed)
        return () => clearInterval(interval);
    }, []);

    // Typewriter reveals the word letter by letter over ~60% of its time on screen
    const [revealed, setRevealed] = useState(1);
    const typewriter = style.caption_animation_type === 'typewriter';
    useEffect(() => {
        setRevealed(1);
        if (!typewriter) return;
        const length = previewWords[currentWordIndex].length;
        const step = Math.max(17, Math.min(67, 360 / length));
        const interval = setInterval(() => setRevealed(n => Math.min(length, n + 1)), step);
        return () => clearInterval(interval);
    }, [currentWordIndex, typewriter]);

    const fullWord = applyCase(previewWords[currentWordIndex], style.text_case);
    const activeWord = typewriter ? Array.from(fullWord).slice(0, revealed).join('') : fullWord;
    // Preview is a 270px-wide stand-in for the 1080px frame
    const px = style.subtitle_size * 0.25;
    const palette = style.color_mix && style.palette && style.palette.length >= 2 ? style.palette : null;
    const colorFor = (index: number) => (style.highlight_mode === 'auto' && index === previewWords.length - 2) ? (style.highlight_color || '#FFE81F')
        : palette ? paletteColorAt(palette, index)
            : style.rainbow_text ? ['#FF5F5F', '#FFC043', '#33D17A', '#3584E4'][index % 4] : (style.color || 'white');
    const wordColor = colorFor(currentWordIndex);
    const exitAnimation = EXIT_CSS[style.caption_animation_type || 'scale'];
    const textStyle = (color: string): CSSProperties => ({
        fontFamily: `"${style.font}", sans-serif`,
        fontSize: `${px}px`,
        fontWeight: NATIVE_BOLD_FONTS.has(style.font) ? 400 : 700,
        WebkitTextStroke: style.stroke_size > 0 ? `${(style.stroke_size * 2 * 0.25)}px black` : undefined,
        paintOrder: 'stroke fill',
        color: style.shadow === 'neon' ? lighten(color, 0.7) : color,
        textShadow: SHADOW_CSS(style.shadow, px, color),
        ...(style.box_color ? {
            display: 'inline-block',
            background: style.box_color,
            padding: `${px * 0.12}px ${px * 0.28}px`,
            borderRadius: `${px * 0.22}px`,
        } : {}),
    });

    return (
        /* Video Area */
        <div
            className="relative mx-auto flex aspect-[9/16] w-full max-w-[270px] items-center justify-center overflow-hidden rounded-lg border border-gray-700 bg-black shadow-md"
        >
            {/* Background Video */}
            <video
                src="https://remotion-reddit-start.s3.eu-north-1.amazonaws.com/Clips/Satisfying/043xj2Ys.mp4"
                className="absolute inset-0 w-full h-full object-cover opacity-80"
                autoPlay
                muted
                loop
                playsInline
            />

            {/* Dark overlay */}
            <div className="absolute inset-0 bg-black/40" />

            {/* CSS Animations */}
            <style>{`
                @keyframes scale-pop {
                    0% { transform: scale(0.5); opacity: 1; }
                    60% { transform: scale(1.1); opacity: 1; }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes slide-up {
                    0% { transform: translateY(20px); opacity: 0; }
                    100% { transform: translateY(0); opacity: 1; }
                }
                @keyframes blur-in {
                    0% { opacity: 0; filter: blur(10px); transform: scale(1.1); }
                    100% { opacity: 1; filter: blur(0px); transform: scale(1); }
                }
                @keyframes fade-in {
                    0% { opacity: 0.6; }
                    100% { opacity: 1; }
                }
                @keyframes punch-pop {
                    0% { transform: scale(0.7); }
                    50% { transform: scale(1.15); }
                    100% { transform: scale(1); }
                }
                @keyframes bounce-up {
                    0% { transform: translateY(9px) scale(0.9); }
                    57% { transform: translateY(-2px) scale(1); }
                    100% { transform: translateY(0) scale(1); }
                }
                @keyframes slow-grow {
                    0% { transform: scale(0.97); }
                    100% { transform: scale(1.07); }
                }
                @keyframes blur-swap {
                    0% { transform: scale(0.94); filter: blur(${px * 0.2}px); }
                    20% { transform: scale(0.94); filter: blur(${px * 0.08}px); }
                    40% { transform: scale(0.94); filter: blur(${px * 0.04}px); }
                    60% { transform: scale(0.97); filter: blur(${px * 0.025}px); }
                    80% { transform: scale(0.97); filter: blur(${px * 0.015}px); }
                    100% { transform: scale(1); filter: blur(0); }
                }
                @keyframes smear-out {
                    0% { transform: translateX(${px * 0.42}px); opacity: 0.5; filter: blur(${px * 0.04}px); }
                    100% { opacity: 0; }
                }
                @keyframes stretch-in {
                    0% { transform: scale(0.6, 3); filter: blur(2.5px); opacity: 0.45; }
                    50% { opacity: 1; }
                    75% { filter: blur(0); }
                    100% { transform: scale(1, 1); filter: blur(0); opacity: 1; }
                }
                @keyframes stretch-out {
                    0% { transform: scale(1, 1); filter: blur(0); opacity: 1; }
                    40% { opacity: 1; }
                    100% { transform: scale(0.8, 2.5); filter: blur(2.5px); opacity: 0; }
                }
                @keyframes smear-in {
                    0% { transform: translateX(${-px * 1.15}px); opacity: 0.5; filter: blur(${px * 0.05}px); }
                    50% { transform: translateX(${-px * 0.38}px); opacity: 0.95; filter: blur(${px * 0.03}px); }
                    100% { transform: translateX(0); opacity: 1; filter: blur(0); }
                }
                @keyframes zoom-punch {
                    0% { transform: scale(1.6); filter: blur(1px); }
                    100% { transform: scale(1); filter: blur(0); }
                }
                @keyframes drop-in {
                    0% { transform: translateY(-35px); }
                    62% { transform: translateY(2.5px); }
                    100% { transform: translateY(0); }
                }
                @keyframes shake {
                    0% { transform: rotate(0) scale(1.1); }
                    18% { transform: rotate(8deg) scale(1); }
                    36% { transform: rotate(-5deg); }
                    54% { transform: rotate(3deg); }
                    72% { transform: rotate(-1.5deg); }
                    100% { transform: rotate(0); }
                }
            `}</style>

            <div className="absolute z-10 text-center px-4 w-full -translate-y-1/2" style={{ top: POSITION_TOP[style.position || 'center'] }}>
                {style.style === 'single' ? (
                    // Old and new words share one grid cell so they overlap (mesh) during the transition
                    <div style={{ display: 'grid' }}>
                        {exitAnimation && previousWordIndex >= 0 && (
                            <div
                                key={`out-${tick}-${style.caption_animation_type}`}
                                style={{ gridArea: '1 / 1', animation: exitAnimation }}
                            >
                                <span style={textStyle(colorFor(previousWordIndex))}>{applyCase(previewWords[previousWordIndex], style.text_case)}</span>
                            </div>
                        )}
                        <div
                            key={`${tick}-${style.caption_animation_type}`} // Trigger animation on word change
                            style={{ gridArea: '1 / 1', animation: ANIMATION_CSS[style.caption_animation_type || 'scale'] || 'none' }}
                        >
                            <span style={textStyle(wordColor)}>{activeWord}</span>
                        </div>
                    </div>
                ) : (
                    <div
                        key={style.caption_animation_type}
                        style={{
                            ...textStyle(style.color || 'white'),
                            lineHeight: 1.2,
                            animation: (ANIMATION_CSS[style.caption_animation_type || 'scale'] || 'none').replace('forwards', 'infinite alternate'),
                            animationDuration: '1.5s'
                        }}
                    >
                        {applyCase(text || sampleText, style.text_case)}
                    </div>
                )}
            </div>
        </div>
    );
}
