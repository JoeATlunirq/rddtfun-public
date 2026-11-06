import { useEffect, useRef, useState } from 'react';
import { hookAnimationState, AWARD_CYCLE_FRAMES, AWARD_LOOP_MIN_FRAMES } from '../../backend/render/hookAnimation.js';
import { fontUrl, FONT_URLS, NATIVE_BOLD_FONTS, hookAccentWordCount, type HookStyleFields } from '@/lib/videoStyles';

// Live 9:16 preview of the hook card. The card is laid out in the renderer's 1080x1920 pixel space
// (same box model as backend/render/layers/hookCard.js) and the animation uses the renderer's own
// frame math, so what plays here is what the video does.

const S3_BUCKET_URL = 'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com';
const BADGE_URL = `${S3_BUCKET_URL}/HookAssets/Images/badge.png`;
// Same awards and order as HOOK_AWARDS in backend/render/constants.js (served from public/hook-awards)
const EMOJI_URLS = [
    '01-shocked-snoo', '02-pyramid', '03-heart', '04-hands', '05-popcorn', '06-dino', '07-seal',
].map(name => `/hook-awards/${name}.webm`);
const BACKGROUND_URL = `${S3_BUCKET_URL}/Clips/Satisfying/043xj2Ys.mp4`;

const HEART_PATH = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
const BUBBLE_PATH = 'M33.468 67.184C15.014 67.184 0 52.17 0 33.715S15.014.246 33.468.246c18.455 0 33.469 15.014 33.469 33.469 0 5.621-1.421 11.161-4.116 16.076l4.608 17.2-16.849-4.516c-5.172 3.084-11.069 4.709-17.112 4.709zm0-62.938C17.219 4.246 4 17.466 4 33.715s13.219 29.469 29.468 29.469c5.582 0 11.021-1.574 15.729-4.554l.74-.468 11.835 3.171-3.243-12.1.419-.72c2.609-4.484 3.988-9.602 3.988-14.799 0-16.248-13.219-29.468-29.468-29.468z';
const SHARE_PATH = 'M20 13v4.5c0 3.0577-4 3-8 3s-8 .0577-8-3V13M12 3v12M12 3l4 4M12 3 8 7';

const FRAME_W = 1080;
const FRAME_H = 1920;
const FPS = 30;
const HOOK_SECONDS = 3.5;
// Blank frames between loops so the entrance is visible every time
const PAUSE_FRAMES = 20;


const withHexAlpha = (color: string, alpha: string, fallback: string) =>
    /^#[0-9a-f]{6}$/i.test(color?.trim() || '') ? `${color.trim()}${alpha}` : fallback;

interface HookPreviewProps {
    hookStyle: HookStyleFields;
    /** Animation used when the style says "use channel setting" */
    fallbackAnimation?: string;
    text?: string;
    channelName?: string;
    width?: number;
}

export function HookPreview({
    hookStyle,
    fallbackAnimation = 'fall',
    text = 'Teachers of Reddit, what is the wildest excuse a student ever gave you?',
    channelName = 'ChannelName',
    width = 270,
}: HookPreviewProps) {
    const font = hookStyle.font && FONT_URLS[hookStyle.font] ? hookStyle.font : 'Roboto';
    useEffect(() => {
        const face = new FontFace(font, `url(${fontUrl(font)})`, { weight: '700' });
        face.load().then(loaded => (document.fonts as any).add(loaded)).catch(() => { });
    }, [font]);

    const variant = hookStyle.animation || fallbackAnimation;
    const hookFrames = Math.ceil(HOOK_SECONDS * FPS);
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        let raf = 0;
        const started = performance.now();
        const tick = (now: number) => {
            setFrame(Math.floor(((now - started) / 1000) * FPS) % (hookFrames + PAUSE_FRAMES));
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [variant, hookFrames]);

    // Like the renderer: clips of 1.5s+ loop, shorter ones play once and restart every 2.4s
    const awardsRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const videos = () => [...(awardsRef.current?.querySelectorAll('video') || [])];
        videos().forEach(v => {
            const setLoop = () => { v.loop = v.duration * FPS >= AWARD_LOOP_MIN_FRAMES; };
            if (v.readyState >= 1) setLoop();
            else v.onloadedmetadata = setLoop;
        });
        const interval = setInterval(() => videos().filter(v => !v.loop).forEach(v => {
            v.currentTime = 0;
            v.play().catch(() => { });
        }), (AWARD_CYCLE_FRAMES / FPS) * 1000);
        return () => clearInterval(interval);
    }, []);

    // Measure the card so the top-position math matches the renderer (top edge of the scaled card at 288px)
    const cardRef = useRef<HTMLDivElement>(null);
    const [cardH, setCardH] = useState(275);
    useEffect(() => {
        const card = cardRef.current;
        if (!card) return;
        const observer = new ResizeObserver(() => setCardH(card.offsetHeight));
        observer.observe(card);
        return () => observer.disconnect();
    }, []);

    const k = Math.max(0.6, Math.min(1.6, hookStyle.scale || 1));
    const state = frame < hookFrames
        ? hookAnimationState(variant, frame, HOOK_SECONDS, FPS)
        : { scale: 0, translateY: 0, rotation: 0, blur: 0, opacity: 0 };
    const visible = state.scale > 0 && state.opacity > 0;
    const top = hookStyle.hookTopPosition ? 288 + (cardH * (k - 1)) / 2 : (FRAME_H - cardH) / 2;

    const titleColor = hookStyle.titleColor || '#1a1a1a';
    const muted = withHexAlpha(titleColor, '88', '#888888');
    const isFloat = variant === 'float';
    const emojiSize = isFloat ? 60 : 45;
    const weight = NATIVE_BOLD_FONTS.has(font) ? 400 : 700;
    const lineHeight = Math.max(0.8, Math.min(1.6, hookStyle.titleLineHeight || 0.9));
    const accentCount = hookStyle.accentColor ? hookAccentWordCount(text, hookStyle.accentMode) : 0;
    const scale = width / FRAME_W;

    // While the card is up with "Hook at Top", the video already shows captions in the middle
    const sampleWords = text.split(/\s+/);
    const captionWord = sampleWords[Math.min(sampleWords.length - 1, Math.floor((frame / hookFrames) * sampleWords.length))];

    return (
        <div
            className="relative mx-auto overflow-hidden rounded-lg border border-gray-700 bg-black shadow-md"
            style={{ width, height: width * (FRAME_H / FRAME_W) }}
        >
            <video src={BACKGROUND_URL} className="absolute inset-0 w-full h-full object-cover" autoPlay muted loop playsInline />
            <div
                className="absolute left-0 top-0"
                style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            >
                {hookStyle.hookTopPosition && frame < hookFrames && (
                    <div
                        className="absolute w-full text-center"
                        style={{
                            top: FRAME_H / 2, transform: 'translateY(-50%)', fontFamily: '"Jellee", sans-serif', fontSize: 90,
                            fontWeight: 700, color: 'white', WebkitTextStroke: '14px black', paintOrder: 'stroke fill',
                        }}
                    >
                        {captionWord}
                    </div>
                )}
                <div
                    ref={cardRef}
                    style={{
                        position: 'absolute',
                        left: (FRAME_W - 800) / 2,
                        top,
                        width: 800,
                        minHeight: 275,
                        boxSizing: 'border-box',
                        padding: '10px 15px',
                        border: `1px solid ${withHexAlpha(titleColor, '44', 'transparent')}`,
                        borderRadius: hookStyle.borderRadius ?? 50,
                        backgroundColor: hookStyle.backgroundColor || '#ffffff',
                        boxShadow: '10px 10px 10px rgba(0, 0, 0, 0.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        fontFamily: `"${font}", sans-serif`,
                        color: titleColor,
                        visibility: visible ? 'visible' : 'hidden',
                        opacity: state.opacity,
                        filter: state.blur > 0.01 ? `blur(${state.blur}px)` : undefined,
                        transform: `translateY(${state.translateY}px) rotate(${state.rotation}deg) scale(${state.scale * k})`,
                        transformOrigin: 'center',
                    }}
                >
                    {/* Header: avatar, name + badge, award emojis, menu dots */}
                    <div style={{ display: 'flex', height: 116, position: 'relative' }}>
                        <div style={{ width: 116, height: 116, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(135deg, #FF4500 0%, #FF6B35 100%)' }} />
                        <div style={{ marginLeft: 15, paddingTop: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', height: 47, fontSize: 40, fontWeight: weight }}>
                                {channelName}
                                <img src={BADGE_URL} alt="" style={{ height: 40, marginLeft: 5 }} />
                            </div>
                            <div ref={awardsRef} style={{ display: 'flex', gap: isFloat ? 0 : 2, marginTop: -3 }}>
                                {EMOJI_URLS.map(src => (
                                    <video key={src} src={src} autoPlay muted playsInline style={{ width: emojiSize, height: emojiSize }} />
                                ))}
                            </div>
                        </div>
                        {hookStyle.menuDots && (
                            <div style={{ position: 'absolute', right: 30 - 6.5, top: 10 + 23.5 - 6.5, display: 'flex', flexDirection: 'row-reverse', gap: 22 - 13 }}>
                                {[0, 1, 2].map(i => <span key={i} style={{ width: 13, height: 13, borderRadius: '50%', background: titleColor }} />)}
                            </div>
                        )}
                    </div>

                    {/* Title */}
                    <div style={{ margin: '3px 0 0 6px', width: '95%', fontSize: 45, lineHeight, fontWeight: weight, flex: 1 }}>
                        {text.split(' ').map((word, i) => {
                            const accented = i < accentCount;
                            const bare = accented ? word.replace(/[,.:;!?]+$/, '') : word;
                            return (
                                <span key={i}>
                                    <span style={accented ? { color: hookStyle.accentColor } : undefined}>{bare}</span>
                                    {word.slice(bare.length)}{' '}
                                </span>
                            );
                        })}
                    </div>

                    {/* Footer: likes, comments, share */}
                    <div style={{ display: 'flex', alignItems: 'center', height: 40, margin: '10px 0', padding: '0 0 0 20px', fontSize: 28, fontWeight: weight, color: muted }}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={HEART_PATH} /></svg>
                        <span style={{ marginLeft: 10, marginRight: 20 }}>99+</span>
                        <svg width="40" height="40" viewBox="0 0 67.429 67.429" fill={muted}><path d={BUBBLE_PATH} /></svg>
                        <span style={{ marginLeft: 10 }}>99+</span>
                        <span style={{ marginLeft: 'auto', marginRight: 100, display: 'flex', alignItems: 'center' }}>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={SHARE_PATH} /></svg>
                            <span style={{ marginLeft: 10 }}>Share</span>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
