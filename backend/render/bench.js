#!/usr/bin/env node
// Fixture render + benchmark for the local renderer.
// Usage: node backend/render/bench.js [--duration 180] [--filter none] [--anim scale] [--hook fall] [--out file.mp4]
//   caption look: [--font Jellee] [--size 100] [--stroke 8] [--case upper] [--shadow hard|soft|neon] [--highlight] [--plain] [--position upper]
//                 [--color '#FFE81F'] [--palette '#fff,#1ED8FF,#2EEB3B'] [--box '#FFE81F']
//   hook card:    [--top] [--dark] [--dots] [--accent] [--scale 1.12] [--hookText "..."]
//   long-form:    [--format landscape] [--bg file-or-url,...] (landscape defaults: card scale 1.6, no mirroring)
import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { renderVideo } from './index.js';
import { runFfmpeg } from './ffmpeg.js';
import { ensureCacheDirs, cacheDirs } from './assets.js';
import { FPS } from './constants.js';

const { values } = parseArgs({
    options: {
        duration: { type: 'string', default: '180' },
        hookSeconds: { type: 'string', default: '3.5' },
        filter: { type: 'string', default: 'none' },
        anim: { type: 'string', default: 'scale' },
        hook: { type: 'string', default: 'fall' },
        out: { type: 'string' },
        top: { type: 'boolean', default: false },
        music: { type: 'boolean', default: false },
        font: { type: 'string', default: 'Jellee' },
        size: { type: 'string', default: '100' },
        stroke: { type: 'string', default: '8' },
        case: { type: 'string', default: 'none' },
        shadow: { type: 'string', default: 'none' },
        position: { type: 'string', default: 'center' },
        highlight: { type: 'boolean', default: false },
        plain: { type: 'boolean', default: false },
        color: { type: 'string', default: '#FFFFFF' },
        palette: { type: 'string' },
        box: { type: 'string' },
        dark: { type: 'boolean', default: false },
        dots: { type: 'boolean', default: false },
        accent: { type: 'boolean', default: false },
        scale: { type: 'string', default: '1' },
        format: { type: 'string', default: 'portrait' },
        bg: { type: 'string' },
        hookText: { type: 'string', default: 'My roommate had a secret account and what I found changed everything' },
    },
});

const SAMPLE_CLIPS = ['043xj2Ys', '06cpZQME', '08iLsmft', '09yMHXBR', '0A7d0zBz']
    .map(id => `https://remotion-reddit-start.s3.eu-north-1.amazonaws.com/Clips/Satisfying/${id}.mp4`);
const WORDS = 'so I finally told my roommate that I knew about the secret account and honestly her reaction was WILD you will not believe what happened next'.split(' ');
const PRESET_HOOKS = ['pop', 'zoom', 'fade', 'slide'];
const RAINBOW = ['#FF5F5F', '#FFC043', '#33D17A', '#3584E4', '#9141AC', '#F66151', '#8FF0A4', '#99C1F1'];

async function toneFile(name, seconds, freq) {
    ensureCacheDirs();
    const file = path.join(cacheDirs.generated, `${name}-${seconds}s.mp3`);
    if (!fs.existsSync(file)) {
        await runFfmpeg(['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`, '-ac', '2', '-b:a', '128k', file]);
    }
    return file;
}

// Evenly timed captions for the hook text (shown while the card is up, like the big channels)
function spreadWords(text, frames) {
    const words = text.split(/\s+/).filter(Boolean);
    const per = frames / words.length;
    return words.map((word, i) => ({ text: word, startFrame: Math.round(i * per), endFrame: Math.round((i + 1) * per), color: '#FFFFFF' }));
}

const duration = Number(values.duration);
const hookSeconds = Number(values.hookSeconds);
const scriptSeconds = Math.max(1, duration - hookSeconds);
const scriptFrames = Math.ceil(scriptSeconds * FPS);
const wordTimings = [];
for (let f = 0, i = 0; f < scriptFrames; f += 9, i++) {
    const word = WORDS[i % WORDS.length];
    wordTimings.push({
        text: values.plain ? word : word.toUpperCase(),
        startFrame: f,
        endFrame: Math.min(scriptFrames, f + 9),
        color: values.plain ? values.color : RAINBOW[i % RAINBOW.length],
    });
}

const spec = {
    channelName: 'Get Brainrot',
    channelImage: '',
    hookText: values.hookText,
    audioUrl: await toneFile('hook', hookSeconds, 440),
    audioDurationInSeconds: hookSeconds,
    hook_animation_type: PRESET_HOOKS.includes(values.hook) ? 'fall' : values.hook,
    subtitleText: WORDS.join(' '),
    scriptAudioUrl: await toneFile('script', scriptSeconds, 330),
    scriptAudioDurationInSeconds: scriptSeconds,
    wordTimings,
    hookWordTimings: values.hook === 'float' || values.top ? spreadWords(values.hookText, Math.ceil(hookSeconds * FPS)) : [],
    backgroundVideoPath: values.bg ? values.bg.split(',') : SAMPLE_CLIPS,
    format: values.format,
    font: values.font,
    subtitle_size: Number(values.size),
    stroke_size: Number(values.stroke),
    has_background_music: values.music,
    backgroundMusicUrl: values.music ? await toneFile('music', 7, 220) : null,
    background_music_volume: 0.1,
    hookStyle: values.top || values.dark || PRESET_HOOKS.includes(values.hook) ? {
        titleColor: values.dark ? '#FFFFFF' : '#1a1a1a',
        backgroundColor: values.dark ? '#000000' : '#ffffff',
        font: values.top ? 'Roboto' : values.font,
        borderRadius: 40,
        hookTopPosition: values.top,
        // preset hook animations live on the hook style (they override hook_animation_type)
        animation: PRESET_HOOKS.includes(values.hook) ? values.hook : null,
        scale: Number(values.scale),
        menuDots: values.dots,
        titleLineHeight: values.top ? 1.12 : values.format === 'landscape' ? 1.1 : null,
        accentMode: values.accent ? 'lead' : 'none',
        accentColor: '#FF4B4B',
    } : null,
    captionAnimation: values.anim,
    captionLook: {
        textCase: values.case,
        shadow: values.shadow,
        position: values.position,
        highlightMode: values.highlight ? 'auto' : 'none',
        palette: values.palette ? values.palette.split(',') : null,
        boxColor: values.box || null,
    },
    visual_filter: values.filter,
};

const out = path.resolve(values.out || path.join(cacheDirs.tmp, `bench-${values.filter}-${values.anim}-${duration}s.mp4`));
const rss = { peak: 0 };
const timer = setInterval(() => { rss.peak = Math.max(rss.peak, process.memoryUsage().rss); }, 250);
let lastStage = '';
const result = await renderVideo(spec, {
    outputPath: out,
    onProgress: ({ stage, progress }) => {
        if (stage !== lastStage) {
            lastStage = stage;
            process.stdout.write(`\n[${stage}] `);
        }
        process.stdout.write(`${Math.round(progress * 100)}% `);
    },
});
clearInterval(timer);
console.log(`\n${JSON.stringify({ ...result, peakRssMB: Math.round(rss.peak / 1048576) })}`);
