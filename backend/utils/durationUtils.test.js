import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveHookSplitTime, getSpeedFactorForMaximum, selectTargetDuration } from './durationUtils.js';

test('selectTargetDuration keeps a fixed target', () => {
    assert.equal(selectTargetDuration({ targetDuration: 165 }), 165);
});

test('selectTargetDuration chooses an inclusive integer in a range', () => {
    const preset = { targetDurationMin: 160, targetDurationMax: 178 };
    assert.equal(selectTargetDuration(preset, () => 0), 160);
    assert.equal(selectTargetDuration(preset, () => 0.999999), 178);
});

test('selectTargetDuration rejects incomplete and reversed ranges', () => {
    assert.throws(() => selectTargetDuration({ targetDurationMin: 160 }), /minimum and maximum/);
    assert.throws(() => selectTargetDuration({ targetDurationMin: 178, targetDurationMax: 160 }), /minimum and maximum/);
});

test('getSpeedFactorForMaximum never stretches short audio', () => {
    assert.equal(getSpeedFactorForMaximum(30, 160), 1);
    assert.equal(getSpeedFactorForMaximum(75, 160), 1);
    assert.equal(getSpeedFactorForMaximum(160, 160), 1);
});

test('getSpeedFactorForMaximum speeds down audio above the selected cap', () => {
    assert.equal(getSpeedFactorForMaximum(180, 160), 1.125);
});

test('deriveHookSplitTime uses the final hook word timestamp plus a frame margin', () => {
    const timings = [
        { text: 'This', startFrame: 0, endFrame: 10 },
        { text: 'is', startFrame: 11, endFrame: 18 },
        { text: 'important.', startFrame: 19, endFrame: 35 },
        { text: 'Body', startFrame: 40, endFrame: 50 }
    ];
    assert.equal(deriveHookSplitTime('This is important', timings, 10, 30), 37 / 30);
});

test('deriveHookSplitTime handles grouped timing text', () => {
    const timings = [
        { text: 'This is', startFrame: 0, endFrame: 18 },
        { text: 'the hook', startFrame: 19, endFrame: 42 },
        { text: 'Body', startFrame: 45, endFrame: 55 }
    ];
    assert.equal(deriveHookSplitTime('This is the hook', timings, 10, 30), 44 / 30);
});
