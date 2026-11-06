// Sanitize word timings - fill gaps between words exactly (no overlap)
export function sanitizeWordTimings(timings, fps = 30) {
    if (!timings || timings.length === 0) return timings;
    console.log('Sanitizing word timings (exact adjacency)...');
    const MAX_DURATION_SEC = 1.5;
    const MAX_DURATION_FRAMES = Math.ceil(MAX_DURATION_SEC * fps);
    let adjustedCount = 0;

    return timings.map((word, index) => {
        const nextWord = timings[index + 1];
        let newEndFrame = word.endFrame;
        let wasAdjusted = false;

        // 1. Initial duration check (keeps individual words from being absurdly long)
        const duration = newEndFrame - word.startFrame;
        if (duration > MAX_DURATION_FRAMES) {
            newEndFrame = word.startFrame + MAX_DURATION_FRAMES;
            wasAdjusted = true;
        }

        // 2. Interaction with next word - fill gaps exactly (no overlap)
        if (nextWord) {
            // GAP FILLING: If current word ends before next word starts, extend it
            if (newEndFrame < nextWord.startFrame) {
                newEndFrame = nextWord.startFrame;
                wasAdjusted = true;
            }
            // OVERLAP FIX: If current word ends after next word starts, trim it
            else if (newEndFrame > nextWord.startFrame) {
                newEndFrame = nextWord.startFrame;
                wasAdjusted = true;
            }
        }

        // Safety check: ensure start < end
        if (newEndFrame <= word.startFrame) {
            newEndFrame = word.startFrame + 1;
            wasAdjusted = true;
        }

        if (wasAdjusted) adjustedCount++;

        return { ...word, endFrame: newEndFrame };
    });
}
