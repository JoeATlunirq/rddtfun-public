import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { estimateLongVideoSeconds, longformTempo, createLongformPipeline, hookFor, CTA_LINE, ctaArrowSeconds, withCtaLine, splitCta, ctaWasSpoken, voiceCta, ctaCaptionWords, hookCaptionWords, longVideoEta, fitToTarget, presetMusic } from '../services/longformPipeline.js';
import { toTitleCase, fitTitle } from '../render/thumbnail.js';
import { validateInput, view } from '../routes/longform.js';
import { CtaArrow } from '../render/layers/ctaArrow.js';

const words = text => text.split(' ').map((t, i) => ({ text: t, startFrame: i * 15, endFrame: i * 15 + 12 }));

test('ctaArrowSeconds starts the arrow on the first word of the CTA sentence', () => {
    const script = withCtaLine('She finally answered the door. Nobody was there');
    const list = words(script);
    const ctaIndex = list.findIndex(w => w.text === 'Full');
    const scriptSeconds = list.length * 0.5;
    assert.equal(ctaArrowSeconds(list, scriptSeconds), scriptSeconds - ctaIndex * 0.5);
});

test('ctaArrowSeconds falls back to 3.5 s when the script has no CTA sentence', () => {
    assert.equal(ctaArrowSeconds(words('It ended. Then the lights went out and we all ran outside.'), 20), 3.5);
    assert.equal(ctaArrowSeconds([], 20), 3.5);
});

test('toTitleCase capitalizes each word and keeps existing capitals', () => {
    assert.equal(toTitleCase('my parents skipped my $150K wedding'), 'My Parents Skipped My $150K Wedding');
    assert.equal(toTitleCase('i told my AITA story'), 'I Told My AITA Story');
});

test('fitTitle grows short titles and still fits long ones', () => {
    const ctx = createCanvas(10, 10).getContext('2d');
    const box = { family: 'sans-serif', maxWidth: 1220, maxHeight: 506 };
    const short = fitTitle(ctx, 'My Parents Skipped My Surgery', box);
    const long = fitTitle(ctx, 'My Sister Smiled In Front Of 38 Guests, Told My Fiancé I Only Wanted His Money, And Swore I Was Hiding A Secret Man, But He Calmly Pulled Out One Photograph That Silenced The Room.', box);
    assert.ok(short.size >= 110, `short title is large (${short.size}px)`);
    assert.ok(long.size < short.size);
    assert.ok(long.lines.length * long.size * 1.17 <= 506);
    assert.ok(!long.lines.at(-1).endsWith('...'), 'a 180-char title fits without an ellipsis');
});

test('CTA arrow matches the competitor box on 1080x1920 and points down', () => {
    const arrow = new CtaArrow({ frameWidth: 1080, frameHeight: 1920 });
    const pts = arrow.points(0);
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    assert.equal(Math.round(Math.min(...ys)), 1263);
    assert.equal(Math.round(Math.max(...ys)), 1551);
    assert.equal(Math.round(Math.max(...xs) - Math.min(...xs)), 185);
    const tip = pts.find(p => p[1] === Math.max(...ys));
    assert.equal(Math.round(tip[0]), 175);
});

test('CTA arrow bobs ±36 px with a 16-frame period', () => {
    const arrow = new CtaArrow({ frameWidth: 1080, frameHeight: 1920 });
    const top = f => Math.min(...arrow.points(f).map(p => p[1]));
    assert.equal(Math.round(top(4)), 1263 - 36);
    assert.equal(Math.round(top(12)), 1263 + 36);
    assert.equal(Math.round(top(16)), 1263);
});

test('longVideoEta: render-bound once narration has finished', () => {
    const eta = longVideoEta({
        charsDone: 70000, charsTotal: 70000, narrationSeconds: 400, framesDone: 45000, framesNarrated: 90000,
        renderSeconds: 200, partFrames: 9000, estimatedTotalFrames: 90000, historyCharsPerSecond: null,
    });
    // 45k frames left at the measured 225 fps
    assert.equal(Math.round(eta), 205);
});

test('longVideoEta: narration-bound early on adds one part render after the last narration', () => {
    const eta = longVideoEta({
        charsDone: 7000, charsTotal: 70000, narrationSeconds: 70, framesDone: 0, framesNarrated: 9000,
        renderSeconds: 0, partFrames: 9000, estimatedTotalFrames: 90000, historyCharsPerSecond: null,
    });
    // 63k chars at 100 chars/s = 630 s, plus 9000 frames at the default 230 fps
    assert.equal(Math.round(eta), Math.round(630 + 9000 / 230 + 5));
});

test('fitToTarget speeds title + script (CTA included) up to the preset target, never slows down', async () => {
    const calls = [];
    const stretch = async (input, output, factor) => calls.push({ input, output, factor });
    const title = { audioPath: '/w/title/full.wav', durationSec: 10, words: [{ text: 'Hi', startFrame: 0, endFrame: 30 }] };
    const body = { audioPath: '/w/script/full.wav', durationSec: 220, words: [{ text: 'below.', startFrame: 6000, endFrame: 6600 }] };
    const fit = await fitToTarget(title, body, 170, '/w', stretch);
    const factor = 230 / 170;
    assert.equal(calls.length, 2);
    assert.ok(calls.every(c => Math.abs(c.factor - factor) < 1e-9));
    assert.ok(Math.abs(fit.title.durationSec + fit.body.durationSec - 170) < 1e-9);
    assert.equal(fit.body.audioPath, '/w/script-fit.mp3');
    assert.equal(fit.body.words[0].endFrame, Math.round(6600 / factor));

    const short = await fitToTarget(title, { ...body, durationSec: 100 }, 170, '/w', stretch);
    assert.equal(calls.length, 2);
    assert.equal(short.body.durationSec, 100);
    assert.equal((await fitToTarget(title, body, null, '/w', stretch)).body, body);
});

test('presetMusic uses the audio preset track and dB level, like regular shorts', () => {
    assert.deepEqual(presetMusic({ addBackgroundMusic: false, customMusicUrl: 'x.wav' }), {});
    assert.deepEqual(presetMusic(null), {});
    const music = presetMusic({ addBackgroundMusic: true, customMusicUrl: 'x.wav', musicVolumeDb: -20 });
    assert.equal(music.backgroundMusicUrl, 'x.wav');
    assert.ok(Math.abs(music.background_music_volume - 0.1) < 1e-9);
});

test('splitCta finds the script\'s own CTA, keeps closing quotes with the story, and adds one otherwise', () => {
    assert.deepEqual(splitCta('"Jenna, don\'t go home. Your name is in it. Full story on the channel below."'),
        { story: '"Jenna, don\'t go home. Your name is in it."', cta: 'Full story on the channel below.' });
    assert.deepEqual(splitCta('Nobody was there'), { story: 'Nobody was there.', cta: CTA_LINE });
    // "the full story" as part of the story is not a CTA
    assert.equal(splitCta('Then the full story came out.').cta, CTA_LINE);
    assert.equal(splitCta('It ended. Part two is on my channel. Link below.').story, 'It ended.');
});

test('ctaWasSpoken and voiceCta re-voice a dropped CTA, and fail rather than ship without one', async () => {
    const heard = text => text.split(' ').map(t => ({ text: t }));
    const cta = 'Full story on my channel linked below.';
    assert.equal(ctaWasSpoken(cta, heard(cta)), true);
    assert.equal(ctaWasSpoken(cta, heard('in it')), false);
    assert.equal(ctaWasSpoken(cta, []), false);

    const workDir = '/nonexistent/cta-test';
    let calls = 0;
    const flaky = async () => (++calls === 1 ? { words: [] } : { words: heard(cta), ok: true });
    assert.equal((await voiceCta(cta, flaky, { workDir })).ok, true);
    assert.equal(calls, 2);
    await assert.rejects(voiceCta(cta, async () => ({ words: [] }), { workDir }), /did not say the CTA/);
});

test('fitToTarget scales the CTA start with the audio', async () => {
    const title = { audioPath: 't.wav', durationSec: 10, words: [] };
    const body = { audioPath: 's.wav', durationSec: 190, ctaStartSec: 186, words: [] };
    const fit = await fitToTarget(title, body, 100, '/w', async () => { });
    assert.equal(fit.body.ctaStartSec, 93);
    assert.equal(fit.body.durationSec - fit.body.ctaStartSec, 2);
});

test('ctaCaptionWords shows the exact CTA wording across its audio', () => {
    const words = ctaCaptionWords('Full story below.', 2, 300);
    assert.deepEqual(words.map(w => w.text), ['Full', 'story', 'below.']);
    assert.equal(words[0].startFrame, 300);
    assert.equal(words[2].endFrame, 360);
    assert.equal(words[1].startFrame, words[0].endFrame);
});

test('hookCaptionWords keeps the voice timing and the card wording', () => {
    const heard = [{ text: 'Ten', startFrame: 0, endFrame: 5 }, { text: 'days', startFrame: 5, endFrame: 12 }];
    const same = hookCaptionWords('10 Days', heard, '#fff');
    assert.deepEqual(same.map(w => [w.text, w.startFrame, w.endFrame, w.color]), [['10', 0, 5, '#fff'], ['Days', 5, 12, '#fff']]);
    assert.equal(hookCaptionWords('Only 10 Days', heard, '#fff')[0].text, 'Ten');
    assert.deepEqual(hookCaptionWords('Title', null, '#fff'), []);
});

// ---------------------------------------------------------------- separate hooks

const twoHooks = { title: 'Old shared hook', long: { hook: 'Long hook', script: 'Long story.' }, short: { hook: 'Short hook', script: 'Short story.' } };

test('hookFor reads each side and falls back to the shared title of older jobs', () => {
    assert.equal(hookFor(twoHooks, 'long'), 'Long hook');
    assert.equal(hookFor(twoHooks, 'short'), 'Short hook');
    assert.equal(hookFor({ title: 'Old shared hook', long: {}, short: {} }, 'short'), 'Old shared hook');
});

test('validateInput needs a hook on each side', () => {
    const body = { long: { hook: 'L', script: 'x' }, short: { hook: 'S', script: 'y' } };
    assert.equal(validateInput(body), null);
    assert.match(validateInput({ ...body, long: { script: 'x' } }), /Long video hook/);
    assert.match(validateInput({ ...body, short: { hook: '  ', script: 'y' } }), /Promo short hook/);
});

test('each video voices its own hook', async () => {
    const voiced = [];
    const narrate = async (text, { workDir }) => { voiced.push({ text, workDir }); throw new Error('stop after the hook'); };
    const steps = createLongformPipeline({ narrate, dataDir: '/tmp', publicDir: '/tmp' });
    const job = { input: twoHooks, data: { settings: {}, config: { long: {}, short: {} } }, outputs: {} };
    const ctx = name => ({ workDir: `/tmp/job/${name}`, setData() { }, setOutput() { }, progress() { }, signal: new AbortController().signal });
    await assert.rejects(steps.find(s => s.id === 'long_video').run(job, ctx('long_video')), /stop/);
    await assert.rejects(steps.find(s => s.id === 'narrate_short').run(job, ctx('narrate_short')), /stop/);
    assert.ok(voiced.some(v => v.text === 'Long hook' && v.workDir === '/tmp/job/long_video/title'));
    assert.ok(voiced.some(v => v.text === 'Short hook' && v.workDir === '/tmp/job/narrate_short/title'));
    assert.ok(!voiced.some(v => v.text === 'Old shared hook'));
});

test('the library saves each video under its own hook', async () => {
    const saved = [];
    const steps = createLongformPipeline({ saveVideo: async v => { saved.push(v); }, dataDir: '/tmp', publicDir: '/tmp' });
    const narration = { title: { durationSec: 1 }, script: { durationSec: 2 } };
    const job = { input: twoHooks, data: { longNarration: narration, shortNarration: narration }, outputs: { longVideo: '/l.mp4', shortVideo: '/s.mp4' } };
    await steps.find(s => s.id === 'save').run(job, { setData() { } });
    assert.deepEqual(saved.map(v => [v.title, v.hook_text, v.video_url]), [['Long hook', 'Long hook', '/l.mp4'], ['Short hook', 'Short hook', '/s.mp4']]);
});

test('video lengths are real once narrated, and the short estimate stops at its target', () => {
    const job = { input: { long: { hook: 'L', script: 'x'.repeat(3000) }, short: { hook: 'S', script: 'y'.repeat(3000) } }, steps: [] };
    const narrated = { longNarration: { title: { durationSec: 3.4 }, script: { durationSec: 16.6 } }, shortNarration: { title: { durationSec: 2.5 }, script: { durationSec: 13.7 } } };
    assert.deepEqual(view(job, narrated).estimates, { shortAudioSeconds: 16, longAudioSeconds: 20 });
    const config = { long: { audio: { ttsProvider: 'fish' } }, short: { audio: { ttsProvider: 'fish' } } };
    const before = view(job, { config, shortTargetSeconds: 160 }).estimates;
    assert.equal(before.shortAudioSeconds, 160);
    assert.ok(before.longAudioSeconds > 160);
    assert.ok(view(job, undefined).estimates.longAudioSeconds < before.longAudioSeconds, 'local voice reads faster than the job\'s Fish voice');
});

test('long videos play at 1.2x and their length estimate follows it', () => {
    assert.equal(longformTempo(), 1.2);
    // 21,000 chars at 17.5 chars/s x 1.2 = 1000 s
    assert.ok(Math.abs(estimateLongVideoSeconds('x'.repeat(21000), 'local') - 1000) < 1e-6);
    process.env.LONGFORM_TEMPO = '1.5';
    assert.equal(longformTempo(), 1.5);
    delete process.env.LONGFORM_TEMPO;
});
