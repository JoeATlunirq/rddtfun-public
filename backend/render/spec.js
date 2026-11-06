import { z } from 'zod';
import { CAPTION_ANIMATIONS } from './timeline.js';
import { CAPTION_TEXT_CASES, CAPTION_SHADOWS, CAPTION_POSITIONS, CAPTION_HIGHLIGHT_MODES } from './styles.js';

export const HOOK_ANIMATIONS = ['fall', 'float', 'pop', 'zoom', 'fade', 'slide'];

const wordTiming = z.object({
    text: z.string(),
    startFrame: z.number(),
    endFrame: z.number(),
    color: z.string().optional().nullable(),
});

const backgroundItem = z.union([
    z.string(),
    z.object({ path: z.string(), durationInFrames: z.number().optional(), durationInSeconds: z.number().optional() }),
]);

/** Render input — same prop names as the old Remotion MainComposition. */
export const renderSpecSchema = z.object({
    channelName: z.string().default('Default Channel'),
    channelImage: z.string().optional().nullable(),
    hookText: z.string().default(''),
    audioUrl: z.string().optional().nullable(),
    audioDurationInSeconds: z.number().nonnegative(),
    hook_animation_type: z.enum(HOOK_ANIMATIONS).optional().nullable(),
    subtitleText: z.string().default(''),
    scriptAudioUrl: z.string().optional().nullable(),
    scriptAudioDurationInSeconds: z.number().nonnegative(),
    wordTimings: z.array(wordTiming).default([]),
    totalDurationInFrames: z.number().optional(),
    backgroundVideoPath: z.union([backgroundItem, z.array(backgroundItem)]).optional().nullable(),
    subtitle_size: z.number().optional().nullable(),
    stroke_size: z.number().optional().nullable(),
    font: z.string().optional().nullable(),
    fontUrl: z.string().optional().nullable(),
    has_background_music: z.boolean().optional().nullable(),
    background_music_volume: z.number().optional().nullable(),
    backgroundMusicUrl: z.string().optional().nullable(),
    isSingleAudioBlock: z.boolean().optional().nullable(),
    hookSplitTime: z.number().optional().nullable(),
    hookStyle: z.object({
        titleColor: z.string(),
        backgroundColor: z.string(),
        font: z.string(),
        borderRadius: z.number(),
        hookTopPosition: z.boolean().optional().nullable(),
        // Newer options come from user-saved preset JSON: bad values fall back instead of failing the render
        // Overrides hook_animation_type when set
        animation: z.enum(HOOK_ANIMATIONS).nullable().optional().catch(null),
        // Card size multiplier (the big channels use ~1.1-1.2x)
        scale: z.number().min(0.6).max(1.6).nullable().optional().catch(null),
        accentColor: z.string().nullable().optional().catch(null),
        accentMode: z.enum(['none', 'lead']).nullable().optional().catch(null),
        menuDots: z.boolean().nullable().optional().catch(null),
        titleLineHeight: z.number().nullable().optional().catch(null),
    }).passthrough().optional().nullable(),
    hookWordTimings: z.array(wordTiming).optional().nullable(),
    captionAnimation: z.enum(CAPTION_ANIMATIONS).optional().nullable(),
    captionLook: z.object({
        textCase: z.enum(CAPTION_TEXT_CASES).optional().nullable(),
        shadow: z.enum(CAPTION_SHADOWS).optional().nullable(),
        position: z.enum(CAPTION_POSITIONS).optional().nullable(),
        opticalCenter: z.boolean().optional().nullable(),
        highlightMode: z.enum(CAPTION_HIGHLIGHT_MODES).optional().nullable(),
        highlightColor: z.string().optional().nullable(),
        palette: z.array(z.string()).optional().nullable(),
        boxColor: z.string().optional().nullable(),
        strokeJoin: z.enum(['miter', 'round']).optional().nullable(),
    }).optional().nullable(),
    visual_filter: z.enum(['none', 'crt', 'vhs', 'old-film', 'vibrant', 'dark', 'warm', 'cool']).optional().nullable(),
    // portrait = 1080x1920 short, landscape = 1920x1080 long-form
    format: z.enum(['portrait', 'landscape']).optional().nullable(),
    // Mirror background clips (default: on for portrait, off for landscape gameplay with HUD text)
    mirrorBackground: z.boolean().optional().nullable(),
    rawBackground: z.boolean().optional().nullable(),
    // Promo short ending: red arrow pointing at YouTube's related-video link for the last `seconds`
    ctaArrow: z.object({ seconds: z.number().positive().max(15).default(3.5) }).optional().nullable(),
    // Output bitrate override (long-form uses less than the 12M default)
    videoBitrate: z.string().regex(/^\d+(\.\d+)?[kKmM]$/).optional().nullable(),
    // 'hevc' encodes with the hardware HEVC encoder when available (long-form: ~37% faster than H.264)
    videoCodec: z.enum(['h264', 'hevc']).optional().nullable(),
    // Part N of a video rendered in parts: background clips start this many frames in
    backgroundStartFrame: z.number().int().nonnegative().optional().nullable(),
}).passthrough();

export function parseRenderSpec(input) {
    const result = renderSpecSchema.safeParse(input);
    if (!result.success) {
        const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Invalid render spec: ${issues}`);
    }
    return result.data;
}
