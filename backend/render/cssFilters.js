// Converts CSS filter chains (as used by the old compositions) into an exact affine color
// transform and an ffmpeg colorchannelmixer expression. CSS sepia/saturate/hue-rotate/brightness
// are 3x3 matrices and contrast is an affine map (Filter Effects spec), so a chain composes into
// a single matrix + offset that ffmpeg applies in one pass.

export const VISUAL_FILTERS = {
    'none': null,
    'crt': 'contrast(1.2) brightness(1.1) saturate(1.2)',
    'vibrant': 'contrast(1.2) saturate(1.5) brightness(1.05)',
    'dark': 'contrast(1.25) saturate(0.9) brightness(0.9) sepia(0.2)',
    'warm': 'sepia(0.4) saturate(1.4) contrast(1.1) brightness(1.05)',
    'cool': 'hue-rotate(-15deg) saturate(1.2) contrast(1.1) brightness(1.1)',
    'vhs': 'contrast(1.4) saturate(1.4) brightness(1.1) sepia(0.2)',
    'old-film': 'sepia(0.8) contrast(1.1) brightness(0.9)',
};

const IDENTITY = () => ({ m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], o: [0, 0, 0] });

function parseAmount(raw) {
    const value = String(raw).trim();
    if (value.endsWith('%')) return parseFloat(value) / 100;
    return parseFloat(value);
}

function parseAngle(raw) {
    const value = String(raw).trim();
    const n = parseFloat(value);
    if (value.endsWith('rad')) return n;
    if (value.endsWith('turn')) return n * 2 * Math.PI;
    if (value.endsWith('grad')) return n * Math.PI / 200;
    return n * Math.PI / 180;
}

export function parseCssFilter(filter) {
    if (!filter || filter === 'none') return [];
    const ops = [];
    const re = /([a-z-]+)\(([^)]*)\)/gi;
    let match;
    while ((match = re.exec(filter))) ops.push({ fn: match[1].toLowerCase(), arg: match[2] });
    return ops;
}

function opToAffine({ fn, arg }) {
    switch (fn) {
        case 'brightness': {
            const b = parseAmount(arg);
            return { m: [[b, 0, 0], [0, b, 0], [0, 0, b]], o: [0, 0, 0] };
        }
        case 'contrast': {
            const c = parseAmount(arg);
            const i = 0.5 - 0.5 * c;
            return { m: [[c, 0, 0], [0, c, 0], [0, 0, c]], o: [i, i, i] };
        }
        case 'saturate': {
            const s = parseAmount(arg);
            return {
                m: [
                    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
                    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
                    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
                ],
                o: [0, 0, 0],
            };
        }
        case 'sepia': {
            const a = 1 - Math.min(1, Math.max(0, parseAmount(arg)));
            return {
                m: [
                    [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a],
                    [0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a],
                    [0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a],
                ],
                o: [0, 0, 0],
            };
        }
        case 'grayscale': {
            const a = 1 - Math.min(1, Math.max(0, parseAmount(arg)));
            return {
                m: [
                    [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a],
                    [0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a],
                    [0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a],
                ],
                o: [0, 0, 0],
            };
        }
        case 'hue-rotate': {
            const t = parseAngle(arg);
            const c = Math.cos(t);
            const s = Math.sin(t);
            return {
                m: [
                    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
                    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283],
                    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
                ],
                o: [0, 0, 0],
            };
        }
        default:
            throw new Error(`Unsupported CSS filter function: ${fn}`);
    }
}

// Apply `next` after `prev`: x' = Mn (Mp x + op) + on
function compose(prev, next) {
    const m = [0, 1, 2].map(r => [0, 1, 2].map(c =>
        next.m[r][0] * prev.m[0][c] + next.m[r][1] * prev.m[1][c] + next.m[r][2] * prev.m[2][c]));
    const o = [0, 1, 2].map(r =>
        next.m[r][0] * prev.o[0] + next.m[r][1] * prev.o[1] + next.m[r][2] * prev.o[2] + next.o[r]);
    return { m, o };
}

export function cssFilterToAffine(filter) {
    return parseCssFilter(filter).map(opToAffine).reduce(compose, IDENTITY());
}

/** One affine stage per CSS function; browsers (and Skia) clamp to [0,1] after each stage. */
export function cssFilterStages(filter) {
    return parseCssFilter(filter).map(opToAffine).filter(stage => !isIdentity(stage));
}

export function applyAffine({ m, o }, [r, g, b]) {
    const clamp = v => Math.min(1, Math.max(0, v));
    return [0, 1, 2].map(i => clamp(m[i][0] * r + m[i][1] * g + m[i][2] * b + o[i]));
}

/** Reference implementation of a CSS filter chain on one sRGB color in [0,1]. */
export function applyCssFilter(filter, rgb) {
    return cssFilterStages(filter).reduce((color, stage) => applyAffine(stage, color), rgb);
}

export function isIdentity({ m, o }) {
    const eps = 1e-9;
    return m.every((row, r) => row.every((v, c) => Math.abs(v - (r === c ? 1 : 0)) < eps))
        && o.every(v => Math.abs(v) < eps);
}

const fmt = n => Number(n.toFixed(6)).toString();

function mixerFor(affine) {
    const ch = ['r', 'g', 'b'];
    const parts = [];
    ch.forEach((out, r) => {
        ch.forEach((inp, c) => parts.push(`${out}${inp}=${fmt(affine.m[r][c])}`));
        parts.push(`${out}a=${fmt(affine.o[r])}`);
    });
    return `colorchannelmixer=${parts.join(':')}`;
}

/**
 * ffmpeg filter chain that applies CSS filter chains (in order) to a yuv420p bt709 stream and
 * returns yuv420p. Runs in gbrap with opaque alpha so the alpha coefficient acts as the affine
 * offset term; each CSS function is its own clamped stage, matching browser behavior.
 */
export function cssFilterToFfmpeg(...filters) {
    const stages = filters.flatMap(f => cssFilterStages(f));
    if (stages.length === 0) return null;
    return [
        'scale=in_color_matrix=bt709:in_range=tv',
        'format=gbrap',
        ...stages.map(mixerFor),
        'scale=out_color_matrix=bt709:out_range=tv',
        'format=yuv420p',
    ].join(',');
}
