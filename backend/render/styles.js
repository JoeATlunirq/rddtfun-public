// Caption "look" options and hook-style helpers modelled on the big Reddit story channels.

export const CAPTION_TEXT_CASES = ['none', 'upper', 'lower'];
// neon = glow in the word's own color
export const CAPTION_SHADOWS = ['none', 'hard', 'soft', 'neon'];
export const CAPTION_POSITIONS = ['center', 'upper', 'lower'];
export const CAPTION_HIGHLIGHT_MODES = ['none', 'auto'];

// Vertical center of the caption block, as a fraction of the frame height
export const CAPTION_POSITION_Y = { center: 0.5, upper: 0.36, lower: 0.68 };

export const DEFAULT_CAPTION_LOOK = Object.freeze({
    textCase: 'none',
    shadow: 'none',
    position: 'center',
    highlightMode: 'none',
    highlightColor: '#FFE81F',
    // Color mix: words take colors from the palette (deterministic runs), overriding per-word colors
    palette: null,
    // Highlight box behind each caption (CapCut "box" presets)
    boxColor: null,
    // Outline corners: miter (Chrome -webkit-text-stroke look) or round (CapCut / TaleTrailz look)
    strokeJoin: 'miter',
});

const MAX_PALETTE = 8;

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const isColor = value => typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim());

/** Fill defaults and drop unknown values so the renderer never sees a bad option. */
export function normalizeCaptionLook(look) {
    const l = look || {};
    return {
        textCase: pick(l.textCase, CAPTION_TEXT_CASES, DEFAULT_CAPTION_LOOK.textCase),
        shadow: pick(l.shadow, CAPTION_SHADOWS, DEFAULT_CAPTION_LOOK.shadow),
        position: pick(l.position, CAPTION_POSITIONS, DEFAULT_CAPTION_LOOK.position),
        opticalCenter: l.opticalCenter === true,
        highlightMode: pick(l.highlightMode, CAPTION_HIGHLIGHT_MODES, DEFAULT_CAPTION_LOOK.highlightMode),
        highlightColor: isColor(l.highlightColor) ? l.highlightColor.trim() : DEFAULT_CAPTION_LOOK.highlightColor,
        palette: Array.isArray(l.palette) && l.palette.filter(isColor).length >= 2
            ? l.palette.filter(isColor).slice(0, MAX_PALETTE).map(c => c.trim())
            : null,
        boxColor: isColor(l.boxColor) ? l.boxColor.trim() : null,
        strokeJoin: l.strokeJoin === 'round' ? 'round' : 'miter',
    };
}

/** Caption preset JSON (snake_case, as saved by the Presets page) -> render spec `captionLook`. */
export function captionLookFromStyle(style) {
    if (!style) return null;
    const s = style.caption_style || style;
    return normalizeCaptionLook({
        textCase: s.text_case,
        shadow: s.shadow,
        position: s.position,
        highlightMode: s.highlight_mode,
        highlightColor: s.highlight_color,
        palette: s.color_mix ? s.palette : null,
        boxColor: s.box_color,
        strokeJoin: s.stroke_join,
    });
}

export function transformCaptionText(text, textCase) {
    if (textCase === 'upper') return String(text).toUpperCase();
    if (textCase === 'lower') return String(text).toLowerCase();
    return String(text);
}

const STOPWORDS = new Set(('about after again always before because being could would should their there these '
    + 'those which while where really things thing still other every never maybe though through').split(' '));

const EMPHASIS_EVERY = 7;

const isMeaningful = text => String(text).split(/\s+/)
    .map(w => w.replace(/[^\p{L}]/gu, '').toLowerCase())
    .some(w => w.length >= 5 && !STOPWORDS.has(w));

// Small deterministic PRNG (mulberry32) so a re-render picks the same colors
function seededRandom(seed) {
    let t = seed >>> 0;
    return () => {
        t = (t + 0x6D2B79F5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Color mix (TaleTrailz style): each word takes a palette color and the color holds for a short
 * random run of 1-3 words before switching to a different one.
 */
export function applyCaptionPalette(cues, look, seed = 1) {
    const palette = look?.palette;
    if (!palette || palette.length < 2) return cues;
    const random = seededRandom(seed);
    let color = palette[0];
    let left = 0;
    return cues.map(cue => {
        if (left <= 0) {
            const others = palette.filter(c => c !== color);
            color = others[Math.floor(random() * others.length)];
            left = 1 + Math.floor(random() * 3);
        }
        left--;
        return { ...cue, color };
    });
}

/**
 * Color caption cues like the big channels do: numbers/money and exclamations always, plus
 * every 7th cue that carries a meaningful word. Deterministic so re-renders match.
 */
export function applyCaptionHighlights(cues, look) {
    if (!look || look.highlightMode !== 'auto') return cues;
    let meaningful = 0;
    return cues.map(cue => {
        const text = String(cue.text);
        let highlight = /[$€£!]|\d/.test(text);
        if (!highlight && isMeaningful(text)) highlight = ++meaningful % EMPHASIS_EVERY === 0;
        return highlight ? { ...cue, color: look.highlightColor } : cue;
    });
}

/**
 * Number of leading hook words to draw in the accent color.
 * 'lead' colors the AskReddit-style addressee of a question ("Anesthesiologists, what's the one thing...?").
 */
export function hookAccentWordCount(hookText, mode) {
    if (mode !== 'lead') return 0;
    const text = String(hookText || '').trim();
    if (!text.includes('?')) return 0;
    const comma = text.indexOf(',');
    if (comma <= 0) return 0;
    const lead = text.slice(0, comma).split(/\s+/).filter(Boolean);
    return lead.length > 0 && lead.length <= 5 ? lead.length : 0;
}
