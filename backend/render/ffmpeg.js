import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { FPS, WIDTH, HEIGHT } from './constants.js';

const execFileAsync = promisify(execFile);

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** Spawn ffmpeg; resolves when it exits cleanly, rejects with the tail of stderr otherwise. */
export function spawnFfmpeg(args, { signal } = {}) {
    const child = spawn(FFMPEG, ['-hide_banner', '-nostats', '-v', 'error', '-y', ...args], {
        stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-8000);
    });
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, sig) => {
            signal?.removeEventListener('abort', onAbort);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with ${code ?? sig}: ${stderr.trim().split('\n').slice(-6).join(' | ')}`));
        });
    });
    // Writes after ffmpeg exits raise EPIPE; the exit code is the real error.
    child.stdin.on('error', () => { });
    return { child, done };
}

export async function runFfmpeg(args, options) {
    const { child, done } = spawnFfmpeg(args, options);
    child.stdin.end();
    return done;
}

export async function countFrames(file) {
    const { stdout } = await execFileAsync(FFPROBE, [
        '-v', 'error', '-select_streams', 'v:0', '-count_packets',
        '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file,
    ]);
    return parseInt(stdout, 10);
}

/** { width, height, fps, pixFmt } of the first video stream. */
export async function probeVideoStream(file) {
    const { stdout } = await execFileAsync(FFPROBE, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,pix_fmt', '-of', 'json', file,
    ]);
    const stream = JSON.parse(stdout).streams?.[0] || {};
    const [num, den] = String(stream.r_frame_rate || '0/1').split('/').map(Number);
    return { width: stream.width, height: stream.height, fps: den ? num / den : 0, pixFmt: stream.pix_fmt };
}

export async function probeDuration(file) {
    const { stdout } = await execFileAsync(FFPROBE, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    return parseFloat(stdout);
}

let capsPromise = null;

/**
 * Detect hardware encode/decode support once per process. The VideoToolbox encoder is verified
 * with a tiny test encode because it can be listed but unavailable (e.g. some sandboxes).
 */
export function probeCapabilities() {
    if (!capsPromise) capsPromise = detectCapabilities();
    return capsPromise;
}

async function detectCapabilities() {
    const [{ stdout: encoders }, { stdout: decoders }, { stdout: hwaccels }] = await Promise.all([
        execFileAsync(FFMPEG, ['-hide_banner', '-encoders']),
        execFileAsync(FFMPEG, ['-hide_banner', '-decoders']),
        execFileAsync(FFMPEG, ['-hide_banner', '-hwaccels']),
    ]);
    const codec = (process.env.RENDER_CODEC || 'h264').toLowerCase() === 'hevc' ? 'hevc' : 'h264';
    const forced = (process.env.RENDER_ENCODER || '').toLowerCase();
    const vtName = `${codec}_videotoolbox`;

    let videotoolbox = forced !== 'software' && forced !== 'libx264' && encoders.includes(vtName);
    let prioSpeed = false;
    if (videotoolbox) {
        try {
            await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30', '-frames:v', '2', '-c:v', vtName, '-b:v', '2M', '-f', 'null', '-']);
            const { stdout: help } = await execFileAsync(FFMPEG, ['-hide_banner', '-h', `encoder=${vtName}`]);
            prioSpeed = help.includes('prio_speed');
        } catch {
            videotoolbox = false;
        }
    }
    if (!videotoolbox && !encoders.includes(codec === 'hevc' ? 'libx265' : 'libx264')) {
        throw new Error(`No usable ${codec} encoder found in ffmpeg`);
    }
    if (!decoders.includes('libvpx-vp9')) {
        console.warn('[Render] ffmpeg lacks libvpx-vp9; transparent hook emoji clips will be skipped');
    }
    return {
        codec,
        videotoolbox,
        prioSpeed,
        videotoolboxDecode: hwaccels.includes('videotoolbox') && process.env.RENDER_HWACCEL !== '0',
        libvpx: decoders.includes('libvpx-vp9'),
        hevcVideotoolbox: encoders.includes('hevc_videotoolbox'),
    };
}

/**
 * Capabilities for one render's codec. HEVC is asked for by long-form: on Apple Silicon the
 * hardware HEVC encoder runs ~37% faster than H.264 (288 vs 210 fps at 1080p) at equal or better quality.
 */
export function capsForCodec(caps, codec) {
    if (codec !== 'hevc' || caps.codec === 'hevc') return caps;
    if (caps.videotoolbox && caps.hevcVideotoolbox) return { ...caps, codec: 'hevc' };
    return caps;
}

export function videoEncoderArgs(caps, { bitrate = process.env.RENDER_VIDEO_BITRATE || '12M', gop = 60, crf = 18 } = {}) {
    const hevc = caps.codec === 'hevc';
    if (caps.videotoolbox) {
        return [
            '-c:v', hevc ? 'hevc_videotoolbox' : 'h264_videotoolbox',
            '-b:v', bitrate, '-g', String(gop),
            ...(hevc ? ['-tag:v', 'hvc1'] : ['-profile:v', 'high']),
            ...(caps.prioSpeed ? ['-prio_speed', '1'] : []),
            '-pix_fmt', 'yuv420p', ...COLOR_TAGS,
        ];
    }
    return [
        '-c:v', hevc ? 'libx265' : 'libx264', '-preset', 'veryfast', '-crf', String(crf),
        '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
        ...(hevc ? ['-tag:v', 'hvc1'] : ['-profile:v', 'high']),
        '-pix_fmt', 'yuv420p', ...COLOR_TAGS,
    ];
}

const escapeConcatPath = p => p.replace(/'/g, "'\\''");
export const concatListContent = files => files.map(f => `file '${escapeConcatPath(f)}'`).join('\n') + '\n';

// Deterministic per-frame pseudo random in [0,1), same role as Remotion's random(frame).
const frameRandom = (offset, salt = 0) => `(st(0,abs(sin((n+${offset}+${salt})*12.9898))*43758.5453);ld(0)-floor(ld(0)))`;

const toYuva = 'scale=out_color_matrix=bt709:out_range=tv,format=yuva420p';

/**
 * Overlay effects drawn on top of the filtered content (VisualFilterContainer.tsx overlays).
 * Returns filtergraph fragments that consume `[in]` and produce `[out]`.
 */
export function visualOverlayGraph(visualFilter, { frameOffset, overlayInputIndex, width = WIDTH, height = HEIGHT }) {
    const input = overlayInputIndex != null ? `[${overlayInputIndex}:v]` : null;
    switch (visualFilter) {
        case 'crt':
            return [
                `${input}${toYuva},loop=loop=-1:size=1:start=0,setpts=N/${FPS}/TB[fxo]`,
                `[in][fxo]overlay=0:0:shortest=1:format=yuv420[out]`,
            ];
        case 'vhs':
            return [
                `${input}${toYuva},loop=loop=-1:size=1:start=0,setpts=N/${FPS}/TB[fxo]`,
                `[in][fxo]overlay=x='floor(10*${frameRandom(frameOffset)})':y='floor(10*${frameRandom(frameOffset, 100)})':shortest=1:format=yuv420[fx1]`,
                `[fx1]drawbox=x=0:y=${height * 0.9 - 12}:w=${width}:h=22:color=white@0.05:t=fill:enable='gt(mod(n+${frameOffset},120),115)',`
                + `drawbox=x=0:y=${height * 0.9 - 2}:w=${width}:h=2:color=white@0.25:t=fill:enable='gt(mod(n+${frameOffset},120),115)'[out]`,
            ];
        case 'old-film': {
            // Black layer with opacity random(frame)*0.1 == scale RGB by k = 1 - 0.1*r (expressed for tv-range YUV)
            const k = `(1-0.1*${frameRandom(frameOffset)})`;
            return [
                `${input}${toYuva},loop=loop=-1:size=1:start=0,setpts=N/${FPS}/TB[fxo]`,
                `[in][fxo]overlay=0:0:shortest=1:format=yuv420[fx1]`,
                `[fx1]eq=eval=frame:contrast='${k}':brightness='(${k}-1)*0.437255':saturation='${k}'[out]`,
            ];
        }
        default:
            return null;
    }
}

/**
 * Filtergraph for one video segment: background (already prepared) + Skia overlay pipe
 * + CSS color filter + filter overlays.
 */
export function buildSegmentFilter({ trimStart, overlayY, colorFilter, visualFilter, frameOffset, overlayInputIndex, backgroundInputs = 1, width = WIDTH, height = HEIGHT }) {
    const parts = [];
    // The background may arrive as several inputs (a seeked first clip + the clips after it): join them
    const bg = backgroundInputs > 1
        ? `${Array.from({ length: backgroundInputs }, (_, i) => `[${i}:v]`).join('')}concat=n=${backgroundInputs}:v=1:a=0,`
        : '[0:v]';
    parts.push(`${bg}trim=start_frame=${trimStart},setpts=PTS-STARTPTS[bg]`);
    parts.push(`[${backgroundInputs}:v]${toYuva}[ov]`);
    parts.push(`[bg][ov]overlay=x=0:y=${overlayY}:format=yuv420:eof_action=pass[base]`);
    let last = 'base';
    if (colorFilter) {
        parts.push(`[base]${colorFilter}[graded]`);
        last = 'graded';
    }
    const fx = visualOverlayGraph(visualFilter, { frameOffset, overlayInputIndex, width, height });
    if (fx) {
        parts.push(...fx.map(p => p.replace('[in]', `[${last}]`)));
        last = 'out';
    }
    parts.push(`[${last}]format=yuv420p[v]`);
    return parts.join(';');
}

/**
 * Audio mix matching MainComposition: hook audio, script audio placed after the hook
 * (optionally offset into the same file for single-block audio), looped background music.
 */
export function buildAudioArgs(audioPlan, { totalSeconds, files, output }) {
    const inputs = [];
    const chains = [];
    const labels = [];
    const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
    const add = (file, loop = false) => {
        inputs.push(...(loop ? ['-stream_loop', '-1'] : []), '-i', file);
        return inputs.filter(a => a === '-i').length - 1;
    };

    if (audioPlan.hook && files.hook) {
        const i = add(files.hook);
        chains.push(`[${i}:a]${fmt},atrim=start=${audioPlan.hook.offset}:duration=${audioPlan.hook.duration.toFixed(6)},asetpts=PTS-STARTPTS[ah]`);
        labels.push('[ah]');
    }
    if (audioPlan.script && files.script) {
        const i = add(files.script);
        const delayMs = Math.round(audioPlan.script.at * 1000);
        chains.push(`[${i}:a]${fmt},atrim=start=${audioPlan.script.offset.toFixed(6)}:duration=${audioPlan.script.duration.toFixed(6)},asetpts=PTS-STARTPTS,adelay=${delayMs}:all=1[as]`);
        labels.push('[as]');
    }
    if (audioPlan.music && files.music) {
        const i = add(files.music, true);
        chains.push(`[${i}:a]${fmt},volume=${audioPlan.music.volume},atrim=duration=${totalSeconds.toFixed(6)},asetpts=PTS-STARTPTS[am]`);
        labels.push('[am]');
    }

    let graph;
    if (labels.length === 0) {
        inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
        graph = `[0:a]atrim=duration=${totalSeconds.toFixed(6)}[a]`;
    } else {
        const mix = labels.length > 1
            ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,`
            : `${labels[0]}`;
        graph = [...chains, `${mix}${labels.length > 1 ? '' : 'anull,'}apad,atrim=duration=${totalSeconds.toFixed(6)}[a]`].join(';');
    }
    return [...inputs, '-filter_complex', graph, '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', output];
}

export function buildFinalizeArgs({ segmentList, audioFile, totalSeconds, output }) {
    return [
        '-f', 'concat', '-safe', '0', '-i', segmentList,
        '-i', audioFile,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c', 'copy', '-t', totalSeconds.toFixed(6),
        '-movflags', '+faststart',
        output,
    ];
}
