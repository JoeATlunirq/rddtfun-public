import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, bezier } from './easing.js';
import { buildTimeline, buildCaptionCues, offsetSingleBlockTimings, cuesAtFrame, planSegments, backgroundWindow, fillCueGaps, createCueCursor } from './timeline.js';
import { CaptionRenderer } from './layers/captions.js';
import { HookCard } from './layers/hookCard.js';
import { frameSize } from './constants.js';
import { VISUAL_FILTERS, applyCssFilter, cssFilterStages, cssFilterToFfmpeg, parseCssFilter } from './cssFilters.js';
import { buildSegmentFilter, buildAudioArgs, buildFinalizeArgs, concatListContent, visualOverlayGraph } from './ffmpeg.js';
import { captionAnimationState } from './layers/captions.js';
import { fallAnimationState, floatAnimationState, hookAnimationState, hookEmojiPixelSize } from './layers/hookCard.js';
import { awardFrameIndex } from './hookAnimation.js';
import { applyCaptionHighlights, applyCaptionPalette, captionLookFromStyle, hookAccentWordCount, normalizeCaptionLook, transformCaptionText } from './styles.js';
import { fontUrlFor, preparedClipKey } from './assets.js';
import { parseRenderSpec } from './spec.js';
import { sanitizeWordTimings } from '../utils/captionUtils.js';

const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('interpolate matches Remotion semantics (clamp, extend, multi-segment)', () => {
    close(interpolate(2, [0, 4, 8], [0.8, 1.05, 1], { extrapolateRight: 'clamp' }), 0.925);
    close(interpolate(6, [0, 4, 8], [0.8, 1.05, 1], { extrapolateRight: 'clamp' }), 1.025);
    close(interpolate(20, [0, 4, 8], [0.8, 1.05, 1], { extrapolateRight: 'clamp' }), 1);
    close(interpolate(-2, [0, 10], [0, 1]), -0.2);
    close(interpolate(-2, [0, 10], [0, 1], { extrapolateLeft: 'clamp' }), 0);
    assert.throws(() => interpolate(1, [0, 0], [0, 1]), /monotonically/);
});

test('bezier easing matches Remotion Easing.bezier reference values', () => {
    // Reference values produced by remotion@4.0.399 interpolate + Easing.bezier(0.87, 0, 0.13, 1)
    const easing = bezier(0.87, 0, 0.13, 1);
    const reference = [[17, 60.61403373177299], [20.5, 642.500000000001], [25, 1254.9920293632074], [2, 171.90338680851428]];
    for (const [frame, expected] of reference) {
        close(interpolate(frame, [13, 28], [0, 1285], { extrapolateRight: 'clamp', easing }), expected, 1e-4);
    }
    const linear = bezier(0.5, 0.5, 0.5, 0.5);
    close(linear(0.3), 0.3);
});

test('caption cues extend motion-blur words by the overlap and fall back to even spacing', () => {
    const timings = [{ text: 'A', startFrame: 0, endFrame: 10 }, { text: 'B', startFrame: 10, endFrame: 15 }];
    assert.deepEqual(buildCaptionCues({ wordTimings: timings, animation: 'motion-blur' }).map(c => c.duration), [15, 10]);
    assert.deepEqual(buildCaptionCues({ wordTimings: timings, animation: 'scale' }).map(c => c.duration), [10, 5]);
    const even = buildCaptionCues({ text: 'one two three', sequenceFrames: 90 });
    assert.deepEqual(even.map(c => [c.start, c.duration]), [[0, 30], [30, 30], [60, 30]]);
});

test('single audio block offsets word timings by the hook split and drops hook words', () => {
    const timings = [{ text: 'hook', startFrame: 0, endFrame: 20 }, { text: 'body', startFrame: 40, endFrame: 60 }];
    const shifted = offsetSingleBlockTimings(timings, true, 1, 30);
    assert.deepEqual(shifted, [{ text: 'body', startFrame: 10, endFrame: 30 }]);
    assert.equal(offsetSingleBlockTimings(timings, false, 1, 30), timings);
});

test('timeline places script cues after the hook and builds the audio plan', () => {
    const t = buildTimeline({
        audioDurationInSeconds: 2.5, scriptAudioDurationInSeconds: 4, audioUrl: 'h.mp3', scriptAudioUrl: 's.mp3',
        wordTimings: [{ text: 'hi', startFrame: 0, endFrame: 9 }], has_background_music: true, backgroundMusicUrl: 'm.mp3',
    });
    assert.equal(t.hookFrames, 75);
    assert.equal(t.totalFrames, 195);
    assert.equal(t.scriptCues[0].start, 75);
    assert.equal(cuesAtFrame(t.scriptCues, 74).length, 0);
    assert.equal(cuesAtFrame(t.scriptCues, 75).length, 1);
    // the last word stays up through the tail of the audio
    assert.equal(cuesAtFrame(t.scriptCues, 84).length, 1);
    assert.equal(cuesAtFrame(t.scriptCues, 194).length, 1);
    assert.deepEqual(t.audio.script, { src: 's.mp3', at: 2.5, offset: 0, duration: 4 });
    assert.equal(t.audio.music.volume, 0.015);
});

test('single-block audio plays the hook up to the split and the script from the split', () => {
    const t = buildTimeline({
        audioDurationInSeconds: 2, scriptAudioDurationInSeconds: 3, audioUrl: 'a.mp3', scriptAudioUrl: 'a.mp3',
        isSingleAudioBlock: true, hookSplitTime: 2,
    });
    assert.equal(t.audio.hook.duration, 2);
    assert.equal(t.audio.script.offset, 2);
    assert.equal(t.audio.script.at, 2);
});

test('segments split hook (full frame) from script chunks', () => {
    assert.deepEqual(planSegments({ hookFrames: 90, totalFrames: 600 }).map(s => [s.kind, s.start, s.end]),
        [['hook', 0, 90], ['script', 90, 600]]);
    const chunks = planSegments({ hookFrames: 0, totalFrames: 900 }, { scriptChunks: 3 });
    assert.deepEqual(chunks.map(s => [s.start, s.end]), [[0, 300], [300, 600], [600, 900]]);
});

test('background window picks covering clips, trims the first and loops when short', () => {
    const clips = [{ path: 'a', frames: 100 }, { path: 'b', frames: 50 }];
    assert.deepEqual(backgroundWindow(clips, 0, 120), { files: ['a', 'b'], trimStart: 0 });
    assert.deepEqual(backgroundWindow(clips, 120, 200), { files: ['b', 'a'], trimStart: 20 });
    assert.deepEqual(backgroundWindow(clips, 310, 330), { files: ['a'], trimStart: 10 });
    assert.equal(backgroundWindow([], 0, 10), null);
});

test('CSS filters follow the Filter Effects spec with per-function clamping', () => {
    assert.deepEqual(parseCssFilter('contrast(150%) hue-rotate(-15deg)').map(o => o.fn), ['contrast', 'hue-rotate']);
    const [r, g, b] = applyCssFilter('brightness(2) contrast(0.5)', [0.8, 0.8, 0.8]);
    // brightness clamps to 1 before contrast: 1 * 0.5 + 0.25
    close(r, 0.75); close(g, 0.75); close(b, 0.75);
    const gray = applyCssFilter('saturate(0)', [1, 0, 0]);
    close(gray[0], 0.213); close(gray[1], 0.213);
    const sepia = applyCssFilter('sepia(1)', [1, 1, 1]);
    close(sepia[0], 1); close(sepia[2], 0.937);
    assert.equal(cssFilterStages('brightness(1)').length, 0);
    assert.equal(cssFilterToFfmpeg(null), null);
    for (const css of Object.values(VISUAL_FILTERS).filter(Boolean)) {
        const chain = cssFilterToFfmpeg(css);
        assert.match(chain, /^scale=in_color_matrix=bt709.*format=gbrap,colorchannelmixer=.*format=yuv420p$/);
        for (const value of chain.matchAll(/[rgb][rgba]=(-?[\d.]+)/g)) {
            assert.ok(Math.abs(Number(value[1])) <= 2, `colorchannelmixer coefficient out of range in ${css}`);
        }
    }
});

test('caption animation states match SubtitleCard', () => {
    assert.deepEqual(captionAnimationState(0, 10, 'scale'), { scale: 0.8, scaleX: 1, scaleY: 1, translateY: 0, opacity: 1, blur: 0, smear: 0, rotation: 0, reveal: null, slideX: 0, smearY: 0 });
    close(captionAnimationState(4, 10, 'scale').scale, 1.05);
    const enter = captionAnimationState(0, 15, 'motion-blur');
    assert.deepEqual([enter.scaleY, enter.scaleX, enter.blur, enter.opacity], [3, 0.6, 10, 0.45]);
    const exit = captionAnimationState(14, 15, 'motion-blur');
    close(exit.scaleY, 2.2); close(exit.opacity, 1 / 3);
    assert.equal(captionAnimationState(0, 10, 'slide').translateY, 20);
    assert.equal(captionAnimationState(5, 10, 'none').opacity, 1);
});

test('channel-style caption animations: pop, bounce, grow, blur-in', () => {
    close(captionAnimationState(0, 10, 'pop').scale, 0.7);
    close(captionAnimationState(3, 10, 'pop').scale, 1.15);
    close(captionAnimationState(9, 10, 'pop').scale, 1);
    assert.equal(captionAnimationState(0, 10, 'bounce').translateY, 36);
    assert.equal(captionAnimationState(7, 10, 'bounce').translateY, 0);
    close(captionAnimationState(0, 20, 'grow').scale, 0.97);
    close(captionAnimationState(20, 20, 'grow').scale, 1.07);
    // CapCut slide crossfade: in from the left, out to the right, both blurred, 50/50 on the cut frame
    const at = f => captionAnimationState(f, 10, 'blur-in');
    assert.deepEqual([at(0).slideX, at(0).opacity, at(0).smear], [-1.15, 0.5, 0.05]);
    assert.deepEqual([at(1).slideX, at(1).opacity, at(1).smear], [-0.38, 0.95, 0.03]);
    assert.deepEqual([at(5).slideX, at(5).opacity, at(5).smear], [0, 1, 0]);
    assert.deepEqual([at(8).slideX, at(8).opacity], [0.26, 0.95]);
    assert.deepEqual([at(9).slideX, at(9).opacity], [0.42, 0.5]);
    // blur swap: outgoing blurs out over its last 2 frames, incoming sharpens over 6, hard cut
    const sw = f => captionAnimationState(f, 12, 'blur-swap');
    assert.deepEqual([sw(0).smear, sw(0).smearY, sw(0).scale], [0.31, 0.055, 0.94]);
    assert.deepEqual([sw(1).smear, sw(2).smear, sw(4).scale, sw(6).smear, sw(6).scale], [0.12, 0.05, 0.97, 0, 1]);
    assert.deepEqual([sw(10).smear, sw(11).smear, sw(11).scale, sw(11).opacity], [0.085, 0.21, 0.97, 1]);
    // words get a 1-frame overlap so the outgoing word shares the cut frame with the incoming one
    const cues = buildCaptionCues({ wordTimings: [{ text: 'a', startFrame: 0, endFrame: 10 }, { text: 'b', startFrame: 10, endFrame: 20 }], animation: 'blur-in' });
    assert.deepEqual(cues.map(c => c.duration), [11, 11]);
});

test('captions never blink between words (regression: flicker on every word change)', () => {
    const wordTimings = [];
    for (let f = 0, i = 0; f < 600; f += 7 + (i % 5), i++) wordTimings.push({ text: `W${i}`, startFrame: f, endFrame: f + 7 + (i % 5) });
    for (const anim of ['scale', 'slide', 'fade', 'motion-blur', 'pop', 'bounce', 'grow', 'blur-in', 'drop', 'shake', 'typewriter', 'punch', 'none']) {
        const t = buildTimeline({ audioDurationInSeconds: 1, scriptAudioDurationInSeconds: 20, wordTimings, captionAnimation: anim });
        const last = t.scriptCues.at(-1);
        // The very first word may enter from nothing; every later frame must show a caption at >= 50% opacity.
        for (let f = t.scriptCues[1].start; f < Math.min(t.totalFrames, last.start + last.duration); f++) {
            const best = Math.max(0, ...cuesAtFrame(t.scriptCues, f).map(c => captionAnimationState(f - c.start, c.duration, anim).opacity));
            assert.ok(best >= 0.5, `${anim}: frame ${f} caption opacity ${best}`);
        }
    }
});

test('no frame is left without a caption (lead-in, pauses, hook handoff, tail)', () => {
    const words = (from, n, step, pauseEvery) => Array.from({ length: n }, (_, i) => ({
        text: `w${i}`, startFrame: from + i * step + Math.floor(i / pauseEvery) * 20, endFrame: from + i * step + Math.floor(i / pauseEvery) * 20 + 6,
    }));
    const top = { titleColor: '#fff', backgroundColor: '#000', font: 'Roboto', borderRadius: 40, hookTopPosition: true };
    const base = { audioDurationInSeconds: 3.5, scriptAudioDurationInSeconds: 20, hookText: 'My boss promoted my lazy co-worker', hookStyle: top };
    const cases = [
        { ...base, hookWordTimings: words(8, 10, 9, 4), wordTimings: words(6, 50, 10, 7) },
        { ...base, hookWordTimings: [], wordTimings: words(25, 40, 12, 5) }, // hook transcription failed
        { ...base, hookStyle: { ...top, hookTopPosition: false }, hook_animation_type: 'float', hookWordTimings: [], wordTimings: words(3, 40, 12, 5) },
    ];
    for (const anim of ['scale', 'motion-blur', 'typewriter', 'blur-in', 'blur-swap']) {
        for (const spec of cases) {
            const t = buildTimeline({ ...spec, captionAnimation: anim });
            for (let f = 0; f < t.totalFrames; f++) {
                const cues = f < t.hookFrames ? t.hookCues : t.scriptCues;
                const best = Math.max(0, ...cuesAtFrame(cues, f).map(c => captionAnimationState(f - c.start, c.duration, anim, c.text.length).opacity));
                assert.ok(best >= 0.4, `${anim}: frame ${f} caption opacity ${best}`);
            }
        }
    }
    // centered hook: the card covers the caption area, so captions start right at the hook end
    const centered = buildTimeline({ audioDurationInSeconds: 3.5, scriptAudioDurationInSeconds: 20, hookText: 'x', wordTimings: words(30, 40, 12, 5) });
    assert.equal(centered.hookCues.length, 0);
    assert.equal(centered.scriptCues[0].start, centered.hookFrames);
    assert.equal(fillCueGaps([], 0, 10).length, 0);
});

test('sanitizeWordTimings fills gaps so captions stay on screen through pauses', () => {
    const out = sanitizeWordTimings([{ text: 'a', startFrame: 0, endFrame: 5 }, { text: 'b', startFrame: 20, endFrame: 25 }], 30);
    assert.equal(out[0].endFrame, 20);
});

test('CapCut-style caption animations: drop, shake, typewriter, punch', () => {
    assert.equal(captionAnimationState(0, 10, 'drop').translateY, -140);
    assert.equal(captionAnimationState(8, 10, 'drop').translateY, 0);
    assert.ok(Math.abs(captionAnimationState(1, 20, 'shake').rotation) > 3);
    assert.equal(captionAnimationState(12, 20, 'shake').rotation, 0);
    // 10 frames * 0.6 / 5 chars = 1.2 frames per char, always at least one char visible
    assert.equal(captionAnimationState(0, 10, 'typewriter', 5).reveal, 1);
    assert.equal(captionAnimationState(3, 10, 'typewriter', 5).reveal, 3);
    assert.equal(captionAnimationState(9, 10, 'typewriter', 5).reveal, 5);
    close(captionAnimationState(0, 10, 'punch').scale, 1.6);
    close(captionAnimationState(4, 10, 'punch').scale, 1);
});

test('color mix assigns palette colors in short deterministic runs', () => {
    const look = normalizeCaptionLook({ palette: ['#FFFFFF', '#1ED8FF', '#2EEB3B', '#FFEE1A'] });
    const cues = Array.from({ length: 40 }, (_, i) => ({ text: `w${i}`, start: i, duration: 1, color: '#123456' }));
    const colored = applyCaptionPalette(cues, look);
    assert.deepEqual(colored.map(c => c.color), applyCaptionPalette(cues, look).map(c => c.color));
    assert.ok(colored.every(c => look.palette.includes(c.color)));
    assert.ok(new Set(colored.map(c => c.color)).size >= 3);
    let run = 1;
    for (let i = 1; i < colored.length; i++) {
        run = colored[i].color === colored[i - 1].color ? run + 1 : 1;
        assert.ok(run <= 3, `run of ${run}`);
    }
    assert.equal(normalizeCaptionLook({ palette: ['#fff'] }).palette, null);
    assert.equal(captionLookFromStyle({ palette: ['#fff', '#000'] }).palette, null, 'palette needs color_mix on');
    assert.deepEqual(captionLookFromStyle({ color_mix: true, palette: ['#fff', '#000'], box_color: '#FFE81F' }).palette, ['#fff', '#000']);
    assert.equal(captionLookFromStyle({ box_color: '#FFE81F' }).boxColor, '#FFE81F');
});

test('caption look: preset mapping, text case and deterministic auto highlights', () => {
    assert.deepEqual(captionLookFromStyle({ caption_style: { text_case: 'upper', shadow: 'hard', highlight_mode: 'auto', highlight_color: '#00FF00' } }),
        { textCase: 'upper', shadow: 'hard', position: 'center', highlightMode: 'auto', highlightColor: '#00FF00', palette: null, boxColor: null, strokeJoin: 'miter', opticalCenter: false });
    assert.deepEqual(normalizeCaptionLook({ shadow: 'sparkles', highlightColor: 'red' }), normalizeCaptionLook(null));
    assert.equal(transformCaptionText("it's fine", 'upper'), "IT'S FINE");
    const cues = ['I', 'paid', '$40', 'for', 'groceries', 'and', 'nobody', 'cared', 'about', 'dinner', 'tonight', 'honestly', 'whatever', 'happened', 'WOW!']
        .map((text, i) => ({ text, start: i, duration: 1, color: '#FFFFFF' }));
    const look = normalizeCaptionLook({ highlightMode: 'auto', highlightColor: '#FFE81F' });
    const colored = applyCaptionHighlights(cues, look).filter(c => c.color === '#FFE81F').map(c => c.text);
    assert.deepEqual(colored, ['$40', 'whatever', 'WOW!']);
    assert.equal(applyCaptionHighlights(cues, normalizeCaptionLook(null)), cues);
    const t = buildTimeline({ audioDurationInSeconds: 1, scriptAudioDurationInSeconds: 2, wordTimings: [{ text: '$5', startFrame: 0, endFrame: 9 }], captionLook: look });
    assert.equal(t.scriptCues[0].color, '#FFE81F');
});

test('hook accent colors the AskReddit lead phrase only', () => {
    assert.equal(hookAccentWordCount("Anesthesiologists, what's the one thing someone said?", 'lead'), 1);
    assert.equal(hookAccentWordCount('Teachers of Reddit, what was the worst excuse?', 'lead'), 3);
    assert.equal(hookAccentWordCount('I told my sister, and she laughed for an hour straight in my face', 'lead'), 0);
    assert.equal(hookAccentWordCount('When he was drunk he confessed that, honestly, he hated me', 'lead'), 0);
    assert.equal(hookAccentWordCount('Anesthesiologists, what?', 'none'), 0);
});

test('preset hook animations enter, hold and are gone by the hook end', () => {
    // 3s hook @30fps: end = 88, exit starts at 80
    for (const variant of ['pop', 'zoom', 'fade', 'slide']) {
        const mid = hookAnimationState(variant, 50, 3, 30);
        close(mid.opacity, 1);
        close(hookAnimationState(variant, 88, 3, 30).opacity, 0);
        assert.equal(hookAnimationState(variant, 90, 3, 30).opacity, 0);
    }
    close(hookAnimationState('fade', 0, 3, 30).opacity, 1);
    close(hookAnimationState('pop', 0, 3, 30).scale, 0.6);
    close(hookAnimationState('pop', 9, 3, 30).scale, 1);
    close(hookAnimationState('zoom', 0, 3, 30).scale, 0.88);
    assert.ok(hookAnimationState('zoom', 40, 3, 30).scale > 0.97);
    assert.equal(hookAnimationState('slide', 0, 3, 30).translateY, -520);
    close(hookAnimationState('slide', 9, 3, 30).translateY, 0);
    assert.equal(hookAnimationState('fall', 0, 3, 30).opacity, 1);
    // very short hooks still produce valid states
    for (const variant of ['pop', 'zoom', 'fade', 'slide']) {
        for (let f = 0; f < 4; f++) assert.ok(Number.isFinite(hookAnimationState(variant, f, 0.1, 30).scale));
    }
});

test('channel fonts resolve to Google Fonts static files', () => {
    assert.match(fontUrlFor('Luckiest Guy'), /^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/.+LuckiestGuy-Regular\.ttf$/);
    assert.match(fontUrlFor('Jellee'), /Jellee-Roman\.ttf$/);
    assert.equal(fontUrlFor('Luckiest Guy', 'https://x/y.ttf'), 'https://x/y.ttf');
});

test('award clips: long ones loop naturally, short one-shots play once and hold for 2.4s', () => {
    // 14-frame one-shot clip: plays 0..13, holds 13 until frame 71, restarts at 72
    assert.deepEqual([0, 13, 14, 71, 72, 85].map(f => awardFrameIndex(f, 14)), [0, 13, 13, 13, 0, 13]);
    // 60- and 77-frame loops repeat with no pause
    assert.deepEqual([59, 60, 61].map(f => awardFrameIndex(f, 60)), [59, 0, 1]);
    assert.deepEqual([76, 77].map(f => awardFrameIndex(f, 77)), [76, 0]);
    assert.equal(awardFrameIndex(10, 0), 0);
    // prepared at the exact output size (card scale applies)
    assert.equal(hookEmojiPixelSize('fade', { scale: 1.12 }), 50);
    assert.equal(hookEmojiPixelSize('float', null), 60);
});

test('hook fall/float animations match the old components at key frames', () => {
    // 3s hook @30fps: audioFrames = 88, fall starts at 73
    const fall0 = fallAnimationState(0, 3, 30);
    close(fall0.scale, 0.7);
    assert.equal(fall0.translateY, 0);
    close(fallAnimationState(12, 3, 30).scale, 1);
    close(fallAnimationState(88, 3, 30).translateY, 1285);
    close(fallAnimationState(88, 3, 30).rotation, 30);
    assert.ok(fallAnimationState(80, 3, 30).blur > 0);
    const float = floatAnimationState(88, 3, 30);
    close(float.scale, 0);
    close(floatAnimationState(12 + 7.5, 3, 30).translateY, 15);
});

test('segment filtergraph wires background, overlay and filter overlays', () => {
    const graph = buildSegmentFilter({ trimStart: 12, overlayY: 600, colorFilter: null, visualFilter: 'crt', frameOffset: 90, overlayInputIndex: 2 });
    assert.match(graph, /\[0:v\]trim=start_frame=12/);
    assert.match(graph, /\[bg\]\[ov\]overlay=x=0:y=600/);
    assert.match(graph, /\[2:v\].*loop=loop=-1/);
    assert.match(graph, /\[out\]format=yuv420p\[v\]$/);
    const plain = buildSegmentFilter({ trimStart: 0, overlayY: 0, visualFilter: null, frameOffset: 0 });
    assert.match(plain, /\[base\]format=yuv420p\[v\]$/);
    assert.match(visualOverlayGraph('vhs', { frameOffset: 30, overlayInputIndex: 2 }).join(';'), /mod\(n\+30,120\)/);
    assert.equal(visualOverlayGraph('warm', { frameOffset: 0, overlayInputIndex: 2 }), null);
});

test('segment filtergraph joins a seeked first clip with the clips after it', () => {
    const graph = buildSegmentFilter({ trimStart: 0, overlayY: 700, visualFilter: null, frameOffset: 0, backgroundInputs: 2 });
    assert.match(graph, /^\[0:v\]\[1:v\]concat=n=2:v=1:a=0,trim=start_frame=0/);
    assert.match(graph, /\[2:v\]scale=.*\[ov\]/);
});

test('audio args mix hook, delayed script and looped music without normalization', () => {
    const args = buildAudioArgs({
        hook: { offset: 0, duration: 2 }, script: { at: 2, offset: 0, duration: 3 }, music: { volume: 0.1 },
    }, { totalSeconds: 5, files: { hook: 'h.mp3', script: 's.mp3', music: 'm.mp3' }, output: 'a.m4a' });
    const graph = args[args.indexOf('-filter_complex') + 1];
    assert.ok(args.includes('-stream_loop'));
    assert.match(graph, /adelay=2000:all=1/);
    assert.match(graph, /amix=inputs=3:normalize=0/);
    assert.match(graph, /atrim=duration=5\.000000\[a\]$/);
    const silent = buildAudioArgs({ hook: null, script: null, music: null }, { totalSeconds: 3, files: {}, output: 'a.m4a' });
    assert.ok(silent.includes('anullsrc=r=48000:cl=stereo'));
});

test('finalize stream-copies concatenated segments with the mixed audio', () => {
    const args = buildFinalizeArgs({ segmentList: 'l.txt', audioFile: 'a.m4a', totalSeconds: 10, output: 'o.mp4' });
    assert.deepEqual(args.slice(args.indexOf('-c'), args.indexOf('-c') + 2), ['-c', 'copy']);
    assert.equal(concatListContent(["/tmp/it's.mp4"]), "file '/tmp/it'\\''s.mp4'\n");
});

test('render spec validation accepts Remotion-shaped props and rejects bad input', () => {
    const spec = parseRenderSpec({ audioDurationInSeconds: 2, scriptAudioDurationInSeconds: 3, wordTimings: [], visual_filter: 'vhs' });
    assert.equal(spec.channelName, 'Default Channel');
    assert.throws(() => parseRenderSpec({ audioDurationInSeconds: 'x', scriptAudioDurationInSeconds: 3 }), /Invalid render spec/);
    assert.throws(() => parseRenderSpec({ audioDurationInSeconds: 1, scriptAudioDurationInSeconds: 1, visual_filter: 'nope' }), /visual_filter/);
    const styled = parseRenderSpec({
        audioDurationInSeconds: 1, scriptAudioDurationInSeconds: 1, captionAnimation: 'blur-in', hook_animation_type: 'zoom',
        captionLook: { textCase: 'upper', shadow: 'soft' },
        hookStyle: { titleColor: '#fff', backgroundColor: '#000', font: 'Poppins Black', borderRadius: 30, animation: 'pop', scale: 1.15, accentMode: 'lead' },
    });
    assert.equal(styled.hookStyle.animation, 'pop');
    const lenient = parseRenderSpec({
        audioDurationInSeconds: 1, scriptAudioDurationInSeconds: 1,
        hookStyle: { titleColor: '#fff', backgroundColor: '#000', font: 'Roboto', borderRadius: 30, animation: 'spin', scale: 9 },
    });
    assert.deepEqual([lenient.hookStyle.animation, lenient.hookStyle.scale], [null, null]);
    assert.throws(() => parseRenderSpec({ audioDurationInSeconds: 1, scriptAudioDurationInSeconds: 1, captionLook: { shadow: 'sparkles' } }), /captionLook/);
});

test('cue cursor returns exactly what cuesAtFrame does, in order', () => {
    // random overlapping cues across two sequences, including long ones and motion-blur overlap
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const cues = [];
    for (let i = 0, f = 0; i < 600; i++) {
        const duration = 1 + Math.floor(rand() * (rand() < 0.05 ? 400 : 12));
        cues.push({ text: `w${i}`, start: f, duration, from: i < 300 ? 0 : 1500, to: i < 300 ? 1500 : 6000 });
        f += Math.floor(rand() * 10);
    }
    const at = createCueCursor(cues);
    for (let frame = 0; frame < 6200; frame++) {
        assert.deepEqual(at(frame).map(c => c.text), cuesAtFrame(cues, frame).map(c => c.text), `frame ${frame}`);
    }
    // going backwards (a new segment) restarts cleanly
    assert.deepEqual(at(10).map(c => c.text), cuesAtFrame(cues, 10).map(c => c.text));
});

test('landscape frame: captions and hook card are laid out on 1920x1080', () => {
    const { width, height } = frameSize('landscape');
    assert.deepEqual([width, height], [1920, 1080]);
    assert.deepEqual(frameSize('nope'), { width: 1080, height: 1920 });
    const captions = new CaptionRenderer({ fontFamily: 'sans-serif', size: 120, frameWidth: width, frameHeight: height });
    assert.equal(captions.centerY, 540);
    assert.equal(captions.maxTextWidth, 1840);
    const band = captions.bandHeight([{ text: 'hello' }]);
    const top = captions.bandTop(band);
    assert.ok(top >= 0 && top + band <= height);
    const card = new HookCard({ hookText: 'My family laughed in my face at the funeral', fontFamily: 'sans-serif', hookStyle: { titleColor: '#000', backgroundColor: '#fff', font: 'x', borderRadius: 40, scale: 1.6 }, audioDurationInSeconds: 3, fps: 30, frameWidth: width, frameHeight: height });
    close(card.left + (card.cardW * 1.6) / 2, width / 2, 1e-6);
    close(card.top + (card.cardH * 1.6) / 2, height / 2, 1e-6);
    const top15 = new HookCard({ hookText: 'x', fontFamily: 'sans-serif', hookStyle: { titleColor: '#000', backgroundColor: '#fff', font: 'x', borderRadius: 40, hookTopPosition: true }, audioDurationInSeconds: 3, fps: 30 });
    assert.equal(top15.top, 288);
});

test('landscape filter graph and spec', () => {
    const g = visualOverlayGraph('vhs', { frameOffset: 0, overlayInputIndex: 2, width: 1920, height: 1080 }).join(';');
    assert.match(g, /drawbox=x=0:y=960:w=1920/);
    assert.equal(parseRenderSpec({ audioDurationInSeconds: 1, scriptAudioDurationInSeconds: 1, format: 'landscape' }).format, 'landscape');
    assert.throws(() => parseRenderSpec({ audioDurationInSeconds: 1, scriptAudioDurationInSeconds: 1, format: 'square' }), /format/);
});

test('prepared clip cache key separates frame size and mirroring, keeps the portrait key', () => {
    const url = 'https://example.com/Clips/a.mp4';
    const portrait = preparedClipKey(url);
    assert.equal(preparedClipKey(url, { width: 1080, height: 1920, mirror: true }), portrait);
    const landscape = preparedClipKey(url, { width: 1920, height: 1080, mirror: false });
    assert.notEqual(landscape, portrait);
    assert.notEqual(preparedClipKey(url, { width: 1920, height: 1080, mirror: true }), landscape);
});

test('long hooks shrink the title so the card stays inside the frame; short hooks are unchanged', () => {
    const style = { titleColor: '#000', backgroundColor: '#fff', font: 'x', borderRadius: 40, scale: 1.6 };
    const make = (hookText, extra = {}) => new HookCard({ hookText, fontFamily: 'sans-serif', hookStyle: { ...style, ...extra.style }, audioDurationInSeconds: 3, fps: 30, frameWidth: 1920, frameHeight: 1080, ...extra.frame });
    assert.equal(make('A short hook').titleSize, 45);
    const hook418 = 'At The Labor Day Fish Fry, My Father-In-Law Took My Son\'s Boat Keys Out Of His Hand And Said, "You\'re Just Why Your Dad Had To Marry Her." Forty People Heard Him. My Brother-In-Law Laughed. His Wife Filmed It. I Didn\'t Say A Word. Three Days Later, I Found Out The Boat Wasn\'t Going Where He\'d Told Everybody It Was Going. And The Man Who\'d Been Calling Me Paperwork For 17 Years Had Brought Some Paperwork Of His Own.';
    const long = make(hook418);
    assert.ok(long.titleSize < 45, `title size ${long.titleSize}`);
    assert.ok(long.cardH * long.k <= 1080 * 0.92 + 1, `card ${long.cardH * long.k}px`);
    assert.ok(long.top >= 0);
    // absurdly long: smallest font, then the whole card scales down, still on screen
    const huge = make(hook418.repeat(6));
    assert.equal(huge.titleSize, 20);
    assert.ok(huge.cardH * huge.k <= 1080 * 0.92 + 1);
    // hook at top on a portrait frame stays above the bottom edge too
    const top = make(hook418.repeat(4), { style: { scale: 1 }, frame: { frameWidth: 1080, frameHeight: 1920 } });
    assert.ok(top.top + top.cardH * top.k <= 1920);
});

test('long-form captions put the letters on the center line; other captions are unchanged', () => {
    const make = look => new CaptionRenderer({ fontFamily: 'sans-serif', size: 110, frameWidth: 1920, frameHeight: 1080, look });
    assert.equal(make({ position: 'center' }).opticalShift, 0);
    const c = make({ position: 'center', opticalCenter: true });
    assert.equal(c.centerY, 540);
    // letter middle = baseline - (cap + x) / 4 must land on the center line, within rounding
    const m = c.measureCtx;
    const cap = m.measureText('H').actualBoundingBoxAscent;
    const x = m.measureText('x').actualBoundingBoxAscent;
    const baseline = c.centerY + c.opticalShift + (c.ascent - c.descent) / 2;
    assert.ok(Math.abs(baseline - (cap + x) / 4 - 540) <= 1, `off by ${baseline - (cap + x) / 4 - 540}`);
    // the caption band still holds the shifted text
    const band = c.bandHeight([{ text: 'hung' }]);
    const top = c.bandTop(band);
    assert.ok(top + band >= 540 + c.opticalShift + c.lineHeight / 2);
    assert.ok(top <= 540 + c.opticalShift - c.lineHeight / 2);
});

test('captions during the hook never sit on the card', () => {
    const make = hookText => new HookCard({ hookText, fontFamily: 'sans-serif', hookStyle: { titleColor: '#fff', backgroundColor: '#000', font: 'x', borderRadius: 40, hookTopPosition: true, scale: 1.12 }, audioDurationInSeconds: 3, fps: 30 });
    const captions = new CaptionRenderer({ fontFamily: 'sans-serif', size: 100, stroke: 8, look: { shadow: 'hard' } });
    // short hook: the card ends above the middle, so captions stay at their normal position
    const short = make('A short hook');
    assert.equal(captions.centerAvoiding(short.span.top, short.span.bottom), captions.centerY);
    // long hook: the card covers the middle, so captions move below it and stay on screen
    const long = make('For 15 Years, My Three Older Siblings Banned Me From Every One Of Their Weddings. '.repeat(5));
    assert.ok(long.span.bottom > captions.centerY);
    const y = captions.centerAvoiding(long.span.top, long.span.bottom);
    assert.ok(y - captions.lineHeight / 2 >= long.span.bottom, `caption at ${y}, card ends ${long.span.bottom}`);
    assert.ok(y + captions.lineHeight / 2 <= 1920);
    // no room on either side: nothing drawn rather than drawn over the card
    assert.equal(captions.centerAvoiding(20, 1900), null);
});
