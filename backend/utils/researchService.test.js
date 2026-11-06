import test from 'node:test';
import assert from 'node:assert/strict';
import { researchUtils } from '../services/researchService.js';

test('normalizes supported YouTube channel identifiers', () => {
    assert.equal(researchUtils.normalizeIdentifier('@MrBeast'), '@MrBeast');
    assert.equal(researchUtils.normalizeIdentifier('https://www.youtube.com/@MrBeast/videos'), '@MrBeast');
    assert.equal(researchUtils.normalizeIdentifier('https://youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA'), 'UCX6OQ3DkcsbYNE6H8uQQuVA');
});

test('rejects unsupported channel identifiers', () => {
    assert.throws(() => researchUtils.normalizeIdentifier('MrBeast'), /valid @handle/);
});

test('parses YouTube ISO durations', () => {
    assert.equal(researchUtils.parseDuration('PT1H2M3S'), 3723);
    assert.equal(researchUtils.parseDuration('PT42S'), 42);
    assert.equal(researchUtils.parseDuration(''), 0);
});

test('cleans speaker markers, music labels, and transcript newlines', () => {
    assert.equal(
        researchUtils.cleanTranscript('Giant tennis, best of three wins.\n>> Not too bad. [music]\\n>> Next round is ours.'),
        'Giant tennis, best of three wins. Not too bad. Next round is ours.'
    );
});

test('removes invisible cue separators and repeated caption blocks', () => {
    assert.equal(
        researchUtils.cleanTranscript('\u200BWe are in the middle of\u200Bthe world’s deadliest jungle.\u200BWe are in the middle of\u200Bthe world’s deadliest jungle.\u200B[suspenseful music]\u200BGo!\u200BGo!'),
        'We are in the middle of the world’s deadliest jungle. Go!'
    );
});
