// Fonts, animations and one-click templates for captions and hook cards.
// Templates copy the look of the biggest Reddit story channels. Keep values in sync with
// backend/render (FONT_FILES in constants.js, animations in timeline.js / layers/hookCard.js).

const S3_BUCKET_URL = 'https://remotion-reddit-start.s3.eu-north-1.amazonaws.com';
const GOOGLE_FONTS_BASE = 'https://raw.githubusercontent.com/google/fonts/main';

export const FONT_URLS: Record<string, string> = {
    'Roboto': `${S3_BUCKET_URL}/Fonts/Roboto.woff2`,
    'Montserrat': `${S3_BUCKET_URL}/Fonts/Montserrat.woff2`,
    'Fredoka': `${S3_BUCKET_URL}/Fonts/Fredoka.woff2`,
    'Komika Axis': `${S3_BUCKET_URL}/Fonts/Roboto.woff2`,
    'Lilita One': `${S3_BUCKET_URL}/Fonts/LilitaOne.woff2`,
    'Jellee': `${S3_BUCKET_URL}/Fonts/Jellee-Roman.ttf`,
    'Ubuntu': `${S3_BUCKET_URL}/Fonts/Ubuntu.woff2`,
    'Luckiest Guy': `${GOOGLE_FONTS_BASE}/apache/luckiestguy/LuckiestGuy-Regular.ttf`,
    'Poppins Black': `${GOOGLE_FONTS_BASE}/ofl/poppins/Poppins-Black.ttf`,
    'Poppins ExtraBold': `${GOOGLE_FONTS_BASE}/ofl/poppins/Poppins-ExtraBold.ttf`,
    'Ubuntu Bold': `${GOOGLE_FONTS_BASE}/ufl/ubuntu/Ubuntu-Bold.ttf`,
    'Anton': `${GOOGLE_FONTS_BASE}/ofl/anton/Anton-Regular.ttf`,
    'Bangers': `${GOOGLE_FONTS_BASE}/ofl/bangers/Bangers-Regular.ttf`,
    // CapCut caption favourites (closest open-licence matches)
    'Archivo Black': `${GOOGLE_FONTS_BASE}/ofl/archivoblack/ArchivoBlack-Regular.ttf`,
    'Bebas Neue': `${GOOGLE_FONTS_BASE}/ofl/bebasneue/BebasNeue-Regular.ttf`,
    'Titan One': `${GOOGLE_FONTS_BASE}/ofl/titanone/TitanOne-Regular.ttf`,
    'Paytone One': `${GOOGLE_FONTS_BASE}/ofl/paytoneone/PaytoneOne-Regular.ttf`,
    'Russo One': `${GOOGLE_FONTS_BASE}/ofl/russoone/RussoOne-Regular.ttf`,
};

export const FONT_OPTIONS = [
    'Roboto', 'Montserrat', 'Fredoka', 'Komika Axis', 'Lilita One', 'Jellee', 'Ubuntu',
    'Luckiest Guy', 'Poppins Black', 'Poppins ExtraBold', 'Ubuntu Bold', 'Anton', 'Bangers',
    'Archivo Black', 'Bebas Neue', 'Titan One', 'Paytone One', 'Russo One',
];

// Fonts that ship a heavy weight (the renderer skips faux bold for them)
export const NATIVE_BOLD_FONTS = new Set([
    'Luckiest Guy', 'Poppins Black', 'Poppins ExtraBold', 'Ubuntu Bold', 'Anton', 'Bangers',
    'Archivo Black', 'Bebas Neue', 'Titan One', 'Paytone One', 'Russo One',
]);

export function fontUrl(font?: string) {
    return FONT_URLS[font || 'Roboto'] || FONT_URLS.Roboto;
}

export type CaptionAnimation = 'scale' | 'slide' | 'fade' | 'motion-blur' | 'pop' | 'bounce' | 'grow' | 'blur-in' | 'blur-swap'
    | 'drop' | 'shake' | 'typewriter' | 'punch' | 'none';

export const CAPTION_ANIMATION_OPTIONS: { value: CaptionAnimation; label: string }[] = [
    { value: 'scale', label: 'Scale (Subtle Pop)' },
    { value: 'pop', label: 'Pop (Punchy)' },
    { value: 'bounce', label: 'Bounce Up' },
    { value: 'grow', label: 'Slow Grow' },
    { value: 'blur-swap', label: 'Blur Swap (blur out, blur in)' },
    { value: 'blur-in', label: 'Motion Blur Slide (CapCut)' },
    { value: 'motion-blur', label: 'Motion Blur (Stretch)' },
    { value: 'punch', label: 'Zoom Punch' },
    { value: 'drop', label: 'Drop In' },
    { value: 'shake', label: 'Shake' },
    { value: 'typewriter', label: 'Typewriter' },
    { value: 'slide', label: 'Slide Up' },
    { value: 'fade', label: 'Fade In' },
    { value: 'none', label: 'None (Hard Cut)' },
];

export type HookAnimation = 'fall' | 'float' | 'pop' | 'zoom' | 'fade' | 'slide';

export const HOOK_ANIMATION_OPTIONS: { value: HookAnimation; label: string }[] = [
    { value: 'fade', label: 'Static, Fade Out' },
    { value: 'zoom', label: 'Slow Zoom In' },
    { value: 'pop', label: 'Pop In / Out' },
    { value: 'slide', label: 'Slide Down' },
    { value: 'fall', label: 'Falling' },
    { value: 'float', label: 'Floating' },
];

export interface CaptionLookFields {
    text_case?: 'none' | 'upper' | 'lower';
    shadow?: 'none' | 'hard' | 'soft' | 'neon';
    position?: 'center' | 'upper' | 'lower';
    highlight_mode?: 'none' | 'auto';
    highlight_color?: string;
    // Color mix: words take random palette colors (held for 1-3 words)
    color_mix?: boolean;
    palette?: string[];
    // Box behind each caption (null/undefined = no box)
    box_color?: string | null;
    // Outline corners (round = TaleTrailz / CapCut look)
    stroke_join?: 'miter' | 'round';
}

export const COLOR_MIX_PALETTE = ['#FFFFFF', '#1ED8FF', '#2EEB3B', '#FFEE1A'];

// Mirrors applyCaptionPalette in backend/render/styles.js closely enough for previews
export function paletteColorAt(palette: string[], index: number) {
    let color = palette[0];
    let left = 0;
    let seed = 1;
    const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    for (let i = 0; i <= index; i++) {
        if (left <= 0) {
            const others = palette.filter(c => c !== color);
            color = others[Math.floor(random() * others.length)];
            left = 1 + Math.floor(random() * 3);
        }
        left--;
    }
    return color;
}

export const CAPTION_TEMPLATES = [
    {
        id: 'cartoon-caps',
        name: 'Cartoon Caps',
        group: 'channel',
        inspiredBy: 'Nuke Readit',
        style: {
            font: 'Luckiest Guy', style: 'single', subtitle_size: 92, stroke_size: 7, color: '#FFFFFF',
            caption_animation_type: 'none', text_case: 'upper', shadow: 'hard', position: 'center', highlight_mode: 'none',
        },
    },
    {
        id: 'glow-bold',
        name: 'Glow Bold',
        group: 'channel',
        inspiredBy: 'Reddit Report',
        style: {
            font: 'Poppins ExtraBold', style: 'grouped', subtitle_size: 80, stroke_size: 0, color: '#FFFFFF',
            caption_animation_type: 'grow', text_case: 'none', shadow: 'soft', position: 'center',
            highlight_mode: 'auto', highlight_color: '#FFE81F',
        },
    },
    {
        id: 'bubble-shadow',
        name: 'Bubble Shadow',
        group: 'channel',
        inspiredBy: 'Talereader / Brooks Special',
        style: {
            font: 'Jellee', style: 'grouped', subtitle_size: 84, stroke_size: 5, color: '#FFFFFF',
            caption_animation_type: 'none', text_case: 'none', shadow: 'hard', position: 'center', highlight_mode: 'none',
        },
    },
    {
        id: 'motion-blur-in',
        name: 'Blur Swap',
        group: 'channel',
        inspiredBy: 'TaleTrailz',
        style: {
            font: 'Ubuntu Bold', style: 'single', subtitle_size: 122, stroke_size: 10, stroke_join: 'round', color: '#FFFFFF',
            caption_animation_type: 'blur-swap', text_case: 'none', shadow: 'soft', position: 'center', highlight_mode: 'none',
        },
    },
    {
        id: 'color-mix',
        name: 'Color Mix',
        group: 'channel',
        inspiredBy: 'TaleTrailz (colors)',
        style: {
            font: 'Ubuntu Bold', style: 'single', subtitle_size: 122, stroke_size: 10, stroke_join: 'round', color: '#FFFFFF',
            caption_animation_type: 'blur-swap', text_case: 'none', shadow: 'soft', position: 'center', highlight_mode: 'none',
            color_mix: true, palette: COLOR_MIX_PALETTE,
        },
    },
    {
        id: 'blur-swap-caps',
        name: 'Blur Swap Caps',
        group: 'channel',
        inspiredBy: 'Victory Voice',
        style: {
            font: 'Poppins ExtraBold', style: 'grouped', subtitle_size: 76, stroke_size: 0, color: '#FFFFFF',
            caption_animation_type: 'blur-swap', text_case: 'upper', shadow: 'soft', position: 'center',
            highlight_mode: 'auto', highlight_color: '#19E6F0',
        },
    },
    // Single-word looks from the most used CapCut caption presets
    {
        id: 'capcut-bold-pop',
        name: 'Bold Pop',
        group: 'capcut',
        inspiredBy: 'Bold caps + green keywords',
        style: {
            font: 'Archivo Black', style: 'single', subtitle_size: 90, stroke_size: 6, color: '#FFFFFF',
            caption_animation_type: 'pop', text_case: 'upper', shadow: 'hard', position: 'center',
            highlight_mode: 'auto', highlight_color: '#3CFF4F',
        },
    },
    {
        id: 'capcut-yellow-box',
        name: 'Yellow Box',
        group: 'capcut',
        inspiredBy: 'Highlight box',
        style: {
            font: 'Archivo Black', style: 'single', subtitle_size: 80, stroke_size: 0, color: '#000000',
            caption_animation_type: 'pop', text_case: 'upper', shadow: 'none', position: 'center', highlight_mode: 'none',
            box_color: '#FFE81F',
        },
    },
    {
        id: 'capcut-dark-box',
        name: 'Dark Box',
        group: 'capcut',
        inspiredBy: 'Subtitle box',
        style: {
            font: 'Poppins Black', style: 'single', subtitle_size: 78, stroke_size: 0, color: '#FFFFFF',
            caption_animation_type: 'bounce', text_case: 'none', shadow: 'none', position: 'center', highlight_mode: 'none',
            box_color: '#000000B3',
        },
    },
    {
        id: 'capcut-comic-drop',
        name: 'Comic Drop',
        group: 'capcut',
        inspiredBy: 'Comic yellow',
        style: {
            font: 'Bangers', style: 'single', subtitle_size: 100, stroke_size: 8, color: '#FFE81F',
            caption_animation_type: 'drop', text_case: 'upper', shadow: 'hard', position: 'center', highlight_mode: 'none',
        },
    },
    {
        id: 'capcut-typewriter',
        name: 'Typewriter',
        group: 'capcut',
        inspiredBy: 'Typing reveal',
        style: {
            font: 'Poppins ExtraBold', style: 'single', subtitle_size: 84, stroke_size: 0, color: '#FFFFFF',
            caption_animation_type: 'typewriter', text_case: 'none', shadow: 'soft', position: 'center', highlight_mode: 'none',
        },
    },
    {
        id: 'capcut-shake',
        name: 'Shake Caps',
        group: 'capcut',
        inspiredBy: 'Tall caps + red keywords',
        style: {
            font: 'Bebas Neue', style: 'single', subtitle_size: 120, stroke_size: 5, color: '#FFFFFF',
            caption_animation_type: 'shake', text_case: 'upper', shadow: 'hard', position: 'center',
            highlight_mode: 'auto', highlight_color: '#FF3B3B',
        },
    },
    {
        id: 'capcut-zoom-punch',
        name: 'Zoom Punch',
        group: 'capcut',
        inspiredBy: 'Zoom out',
        style: {
            font: 'Titan One', style: 'single', subtitle_size: 88, stroke_size: 7, color: '#FFFFFF',
            caption_animation_type: 'punch', text_case: 'none', shadow: 'hard', position: 'center', highlight_mode: 'none',
        },
    },
    {
        id: 'capcut-neon',
        name: 'Neon Glow',
        group: 'capcut',
        inspiredBy: 'Neon',
        style: {
            font: 'Paytone One', style: 'single', subtitle_size: 86, stroke_size: 0, color: '#3DF5FF',
            caption_animation_type: 'scale', text_case: 'none', shadow: 'neon', position: 'center', highlight_mode: 'none',
        },
    },
    {
        id: 'capcut-gamer',
        name: 'Gamer Mix',
        group: 'capcut',
        inspiredBy: 'Gaming color mix',
        style: {
            font: 'Russo One', style: 'single', subtitle_size: 88, stroke_size: 6, color: '#FFFFFF',
            caption_animation_type: 'pop', text_case: 'upper', shadow: 'hard', position: 'center', highlight_mode: 'none',
            color_mix: true, palette: ['#FFFFFF', '#FF3BD4', '#39F3FF', '#B6FF3B'],
        },
    },
] as const;

export const CAPTION_TEMPLATE_GROUPS = [
    { id: 'channel', label: 'Channel looks' },
    { id: 'capcut', label: 'CapCut single-word presets' },
] as const;

export interface HookStyleFields {
    titleColor: string;
    backgroundColor: string;
    font: string;
    borderRadius?: number;
    hookTopPosition?: boolean;
    animation?: HookAnimation | null;
    scale?: number;
    accentMode?: 'none' | 'lead';
    accentColor?: string;
    menuDots?: boolean;
    titleLineHeight?: number;
}

const darkCard = {
    titleColor: '#FFFFFF', backgroundColor: '#000000', font: 'Roboto', borderRadius: 40, hookTopPosition: true,
    scale: 1.12, menuDots: true, accentMode: 'lead', accentColor: '#FF4B4B', titleLineHeight: 1.12,
} as const;
const lightCard = {
    titleColor: '#111111', backgroundColor: '#FFFFFF', font: 'Roboto', borderRadius: 44, hookTopPosition: true,
    scale: 1.12, menuDots: false, accentMode: 'none', accentColor: '#FF4500', titleLineHeight: 1.12,
} as const;

export const HOOK_STYLE_TEMPLATES: { id: string; name: string; inspiredBy: string; hookStyle: HookStyleFields }[] = [
    { id: 'dark-card', name: 'Dark Card', inspiredBy: 'TaleTrailz / Reddit Report', hookStyle: { ...darkCard, animation: 'fade' } },
    { id: 'light-card', name: 'Light Card', inspiredBy: 'Nuke Readit / Talereader', hookStyle: { ...lightCard, animation: 'fade' } },
    { id: 'dark-zoom', name: 'Dark Zoom', inspiredBy: 'Brooks Special', hookStyle: { ...darkCard, animation: 'zoom' } },
    { id: 'light-pop', name: 'Light Pop', inspiredBy: 'Pop-in card', hookStyle: { ...lightCard, animation: 'pop' } },
];

/** Lead phrase of an AskReddit-style question ("Anesthesiologists, what's..."), mirrors backend hookAccentWordCount. */
export function hookAccentWordCount(text: string, mode?: string) {
    if (mode !== 'lead' || !text.includes('?')) return 0;
    const comma = text.indexOf(',');
    if (comma <= 0) return 0;
    const lead = text.slice(0, comma).trim().split(/\s+/).filter(Boolean);
    return lead.length > 0 && lead.length <= 5 ? lead.length : 0;
}
