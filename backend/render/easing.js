// Frame-math helpers with the same semantics as Remotion's interpolate() and Easing.bezier(),
// so animations ported from the old compositions produce identical values.

function interpolateSegment(input, [inMin, inMax], [outMin, outMax], { easing, extrapolateLeft, extrapolateRight }) {
    let result = input;
    if (result < inMin) {
        if (extrapolateLeft === 'identity') return result;
        if (extrapolateLeft === 'clamp') result = inMin;
    }
    if (result > inMax) {
        if (extrapolateRight === 'identity') return result;
        if (extrapolateRight === 'clamp') result = inMax;
    }
    if (outMin === outMax) return outMin;
    result = (result - inMin) / (inMax - inMin);
    result = easing(result);
    return result * (outMax - outMin) + outMin;
}

export function interpolate(input, inputRange, outputRange, options = {}) {
    if (inputRange.length !== outputRange.length) {
        throw new Error('inputRange and outputRange must have the same length');
    }
    if (inputRange.length < 2) throw new Error('inputRange must have at least 2 elements');
    for (let i = 1; i < inputRange.length; i++) {
        if (!(inputRange[i] > inputRange[i - 1])) {
            throw new Error(`inputRange must be strictly monotonically increasing but got [${inputRange.join(',')}]`);
        }
    }
    const opts = {
        easing: options.easing || (t => t),
        extrapolateLeft: options.extrapolateLeft || 'extend',
        extrapolateRight: options.extrapolateRight || 'extend',
    };
    let i = 1;
    for (; i < inputRange.length - 1; i++) {
        if (inputRange[i] >= input) break;
    }
    i -= 1;
    return interpolateSegment(input, [inputRange[i], inputRange[i + 1]], [outputRange[i], outputRange[i + 1]], opts);
}

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;
const SPLINE_TABLE_SIZE = 11;
const SAMPLE_STEP = 1 / (SPLINE_TABLE_SIZE - 1);

const A = (a1, a2) => 1 - 3 * a2 + 3 * a1;
const B = (a1, a2) => 3 * a2 - 6 * a1;
const C = a1 => 3 * a1;
const calcBezier = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
const getSlope = (t, a1, a2) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);

export function bezier(x1, y1, x2, y2) {
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new Error('bezier x values must be in [0, 1]');
    if (x1 === y1 && x2 === y2) return t => t;

    const samples = new Float64Array(SPLINE_TABLE_SIZE);
    for (let i = 0; i < SPLINE_TABLE_SIZE; i++) samples[i] = calcBezier(i * SAMPLE_STEP, x1, x2);

    const getTForX = (x) => {
        let start = 0;
        let sample = 1;
        const last = SPLINE_TABLE_SIZE - 1;
        for (; sample !== last && samples[sample] <= x; sample++) start += SAMPLE_STEP;
        sample--;
        const dist = (x - samples[sample]) / (samples[sample + 1] - samples[sample]);
        let guess = start + dist * SAMPLE_STEP;
        const slope = getSlope(guess, x1, x2);
        if (slope >= NEWTON_MIN_SLOPE) {
            for (let i = 0; i < NEWTON_ITERATIONS; i++) {
                const s = getSlope(guess, x1, x2);
                if (s === 0) return guess;
                guess -= (calcBezier(guess, x1, x2) - x) / s;
            }
            return guess;
        }
        if (slope === 0) return guess;
        let a = start;
        let b = start + SAMPLE_STEP;
        let current;
        let i = 0;
        do {
            guess = a + (b - a) / 2;
            current = calcBezier(guess, x1, x2) - x;
            if (current > 0) b = guess; else a = guess;
        } while (Math.abs(current) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
        return guess;
    };

    return (t) => {
        if (t === 0 || t === 1) return t;
        return calcBezier(getTForX(t), y1, y2);
    };
}
