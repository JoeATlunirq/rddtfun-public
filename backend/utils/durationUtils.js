const toPositiveNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
};

const tokenize = (value) => String(value || '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}']+/gu) || [];

export function selectTargetDuration(preset, random = Math.random) {
    const minimum = toPositiveNumber(preset?.targetDurationMin ?? preset?.target_duration_min);
    const maximum = toPositiveNumber(preset?.targetDurationMax ?? preset?.target_duration_max);

    if (minimum !== null || maximum !== null) {
        if (minimum === null || maximum === null || maximum < minimum) {
            throw new Error('Target duration range must include a valid minimum and maximum');
        }
        if (minimum === maximum) return minimum;
        return Math.floor(minimum + random() * (Math.floor(maximum) - Math.ceil(minimum) + 1));
    }

    return toPositiveNumber(preset?.targetDuration ?? preset?.target_duration);
}

export function getSpeedFactorForMaximum(duration, maximumDuration) {
    const current = toPositiveNumber(duration);
    const maximum = toPositiveNumber(maximumDuration);
    if (current === null || maximum === null || current <= maximum) return 1;
    return current / maximum;
}

export function deriveHookSplitTime(hookText, wordTimings, totalDuration, fps = 30) {
    const hookWordCount = tokenize(hookText).length;
    const timedWords = (wordTimings || []).flatMap((timing) => {
        const words = tokenize(timing.text);
        return words.map(() => timing);
    });

    if (hookWordCount > 0 && timedWords.length >= hookWordCount) {
        const finalHookWord = timedWords[hookWordCount - 1];
        const split = (finalHookWord.endFrame + 2) / fps;
        return Math.min(Math.max(split, 0.25), Math.max(0.25, totalDuration - 0.05));
    }

    const estimated = Math.max(1, hookWordCount * 0.45);
    return Math.min(estimated, Math.max(0.25, totalDuration * 0.3));
}
