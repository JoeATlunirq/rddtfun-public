import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

// Import helpers/services
import {
    generateAudio,
    generateFishAudio,
    transcribeAudio,
    getAudioDuration,
    ELEVENLABS_MODEL_ID
} from '../utils/audioUtils.js';
import { uploadToSlicr, processWithSlicr } from '../utils/slicrUtils.js';
import { renderVideo } from '../render/index.js';
import { sanitizeWordTimings } from '../utils/captionUtils.js';
import { getSpeedFactorForMaximum, selectTargetDuration } from '../utils/durationUtils.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Init env from parent
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// AWS S3
const s3Client = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    ? new S3Client({
        region: process.env.AWS_BUCKET_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
    })
    : null;

const S3_BUCKET_NAME = process.env.AWS_BUCKET_NAME || 'rddtfun';
const S3_BUCKET_REGION = process.env.AWS_BUCKET_REGION || 'us-east-1';
const S3_BASE_URL = `https://${S3_BUCKET_NAME}.s3.${S3_BUCKET_REGION}.amazonaws.com`;

// Paths
const publicDir = path.resolve(__dirname, '../public');
const audioDir = path.join(publicDir, 'audio');

/**
 * Get S3 background videos (Helper)
 */
async function getS3BackgroundVideos(category, targetDuration, fps) {
    if (!s3Client) {
        console.log('[VideoService] S3 client not configured, skipping background videos');
        return null;
    }

    const categoriesToTry = ['satisfying'];

    for (const cat of categoriesToTry) {
        try {
            const prefix = 'Clips/Satisfying/';
            const command = new ListObjectsV2Command({
                Bucket: S3_BUCKET_NAME,
                Prefix: prefix,
            });

            const response = await s3Client.send(command);
            const contents = response.Contents || [];

            const maxVideoBytes = (Number(process.env.MAX_BACKGROUND_VIDEO_MB) || 20) * 1024 * 1024;
            const videoFiles = contents
                .filter(obj => obj.Key && obj.Key.toLowerCase().endsWith('.mp4') && (obj.Size || 0) <= maxVideoBytes)
                .map(obj => ({
                    key: obj.Key,
                    url: `${S3_BASE_URL}/${obj.Key}`
                }));

            if (videoFiles.length === 0) continue;

            // Shuffle
            const shuffled = [...videoFiles].sort(() => 0.5 - Math.random());

            const videoSequence = [];
            let accumulatedDuration = 0;

            for (const video of shuffled) {
                if (accumulatedDuration >= targetDuration) break;
                try {
                    const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${video.url}"`);
                    const dur = parseFloat(stdout);
                    if (isNaN(dur) || dur <= 0) continue;

                    videoSequence.push({
                        path: video.url,
                        durationInSeconds: dur,
                        durationInFrames: Math.ceil(dur * fps)
                    });
                    accumulatedDuration += dur;
                } catch (err) {
                    console.error('Error getting duration:', err.message);
                }
            }

            if (videoSequence.length > 0) return videoSequence;
        } catch (error) {
            console.error('[VideoService] Error fetching S3 backgrounds:', error.message);
        }
    }
    return null;
}

/**
 * Generate Video Function
 * Reusable by API and Cron
 */
export async function generateVideo(params, onStatusUpdate = () => { }) {
    const {
        hook, script, userId, channelName, channelImageUrl,
        channelFont, channelFontUrl, channelVoiceId, channelStyle,
        elevenlabsApiKey, fishAudioApiKey, openaiApiKey, openrouterApiKey,
        subtitle_size, stroke_size, background_video_type, hook_animation_type,
        captionPreset, hookStylePreset, visualFilterPreset, audioPreset
    } = params;

    const timestamp = Date.now();
    const selectedTargetDuration = selectTargetDuration(audioPreset);
    const finalElevenlabsApiKey = elevenlabsApiKey;
    const finalOpenaiApiKey = openaiApiKey;

    // TTS Provider settings from audio preset
    const ttsProvider = audioPreset?.ttsProvider || 'elevenlabs';
    const fishAudioModelId = audioPreset?.fishAudioModelId;

    // Default settings
    const finalFont = channelFont || 'Luckiest Guy';
    const finalFontUrl = channelFontUrl || null;
    const finalVoiceId = channelVoiceId || audioPreset?.voiceId || 'pNInz6obpgDQGcFmaJgB'; // Adam default
    const finalSubtitleSize = subtitle_size || 50;
    const finalStrokeSize = stroke_size || 8;

    // Audio preset settings (from voice preset)
    const slicrSettings = {
        thresholdDb: audioPreset?.thresholdDb || -35.0,
        minDuration: audioPreset?.minDuration || 0.05,
        leftPadding: audioPreset?.leftPadding || 0,
        rightPadding: audioPreset?.rightPadding || 0,
        addBackgroundMusic: audioPreset?.addBackgroundMusic || false,
        musicVolumeDb: audioPreset?.musicVolumeDb || -13,
        customMusicUrl: audioPreset?.customMusicUrl || null,
        targetDuration: selectedTargetDuration // Combined hook+body target
    };

    console.log('[VideoService] Using Slicr settings:', slicrSettings);
    console.log(`[VideoService] TTS Provider: ${ttsProvider}`);

    // Style
    const stylePreset = captionPreset || {};
    const finalCaptionStyle = {
        font: stylePreset.font || finalFont,
        style: stylePreset.style || channelStyle || 'uppercase',
        subtitle_size: stylePreset.subtitle_size || finalSubtitleSize,
        stroke_size: stylePreset.stroke_size || finalStrokeSize,
        color: stylePreset.color || '#FFFFFF',
        rainbow_text: stylePreset.rainbow_text || false,
        visual_filter: stylePreset.visual_filter || 'none',
        caption_animation_type: stylePreset.caption_animation_type || 'scale',
        look: stylePreset.look || null,
        fontUrl: finalFontUrl
    };

    const visualFilter = visualFilterPreset?.filterType || 'none';

    // Generate audio based on TTS provider
    let hookAudioBuffer, scriptAudioBuffer;

    if (ttsProvider === 'fish' && fishAudioApiKey && fishAudioModelId) {
        onStatusUpdate({ status: 'generating_audio', message: 'Generating audio via Fish Audio...' });

        // 1. Generate Hook Audio (Fish Audio)
        hookAudioBuffer = await generateFishAudio(hook, fishAudioApiKey, fishAudioModelId);
        const hookAudioPath = path.join(audioDir, `${timestamp}-hook.mp3`);
        fs.writeFileSync(hookAudioPath, hookAudioBuffer);

        // 2. Generate Script Audio (Fish Audio)
        onStatusUpdate({ status: 'generating_audio', message: 'Generating script audio via Fish Audio...' });
        scriptAudioBuffer = await generateFishAudio(script, fishAudioApiKey, fishAudioModelId);
        const scriptAudioPath = path.join(audioDir, `${timestamp}-script.mp3`);
        fs.writeFileSync(scriptAudioPath, scriptAudioBuffer);
    } else {
        onStatusUpdate({ status: 'generating_audio', message: 'Generating audio via ElevenLabs...' });

        // 1. Generate Hook Audio (ElevenLabs - raw, natural speed)
        hookAudioBuffer = await generateAudio(hook, finalElevenlabsApiKey, finalVoiceId, ELEVENLABS_MODEL_ID);
        const hookAudioPath = path.join(audioDir, `${timestamp}-hook.mp3`);
        fs.writeFileSync(hookAudioPath, hookAudioBuffer);

        // 2. Generate Script Audio (ElevenLabs - raw, natural speed)
        onStatusUpdate({ status: 'generating_audio', message: 'Generating script audio...' });
        scriptAudioBuffer = await generateAudio(script, finalElevenlabsApiKey, finalVoiceId, ELEVENLABS_MODEL_ID);
        const scriptAudioPath = path.join(audioDir, `${timestamp}-script.mp3`);
        fs.writeFileSync(scriptAudioPath, scriptAudioBuffer);
    }

    const hookAudioPath = path.join(audioDir, `${timestamp}-hook.mp3`);
    const scriptAudioPath = path.join(audioDir, `${timestamp}-script.mp3`);

    // 3. Get natural durations for smart target calculation
    const hookNaturalDuration = await getAudioDuration(hookAudioPath);
    const scriptNaturalDuration = await getAudioDuration(scriptAudioPath);
    const totalNaturalDuration = hookNaturalDuration + scriptNaturalDuration;

    console.log(`[VideoService] Natural durations: hook=${hookNaturalDuration.toFixed(2)}s, script=${scriptNaturalDuration.toFixed(2)}s, total=${totalNaturalDuration.toFixed(2)}s`);

    // 4. Calculate speed factor if target duration is set
    let hookTargetDuration = null;
    let scriptTargetDuration = null;
    let speedFactor = 1.0;

    if (slicrSettings.targetDuration && slicrSettings.targetDuration > 0) {
        const targetTotal = slicrSettings.targetDuration;

        speedFactor = getSpeedFactorForMaximum(totalNaturalDuration, targetTotal);
        if (speedFactor > 1) {
            // Speed up only when audio exceeds the selected maximum

            // Apply same speed factor to both for consistent pitch
            hookTargetDuration = Math.ceil(hookNaturalDuration / speedFactor);
            scriptTargetDuration = Math.ceil(scriptNaturalDuration / speedFactor);

            console.log(`[VideoService] Target duration: ${targetTotal}s, speed factor: ${speedFactor.toFixed(2)}x`);
            console.log(`[VideoService] Calculated targets: hook=${hookTargetDuration}s, script=${scriptTargetDuration}s`);
        } else {
            console.log(`[VideoService] Natural duration is below the selected maximum (${targetTotal}s), keeping 1x speed`);
        }
    }

    // 5. Process Hook with Slicr (with calculated target if needed)
    onStatusUpdate({ status: 'processing_audio', message: 'Processing hook with Slicr...' });
    const hookS3Key = await uploadToSlicr(hookAudioPath, 'audio/mpeg');
    const hookSlicrParams = {
        transcribe: false,
        exportFormat: 'mp3',
        thresholdDb: slicrSettings.thresholdDb,
        minDuration: slicrSettings.minDuration,
        padding: slicrSettings.leftPadding,
        addBackgroundMusic: false, // Never add music to hook
        ...(hookTargetDuration ? { targetDuration: hookTargetDuration } : {})
    };
    const hookSlicrResult = await processWithSlicr(hookS3Key, hookSlicrParams);
    if (!hookSlicrResult.success) throw new Error(`Slicr Hook failed: ${hookSlicrResult.error}`);

    const processedHookPath = path.join(audioDir, `${timestamp}-hook-processed.mp3`);
    const hookResp = await fetch(hookSlicrResult.audioUrl);
    fs.writeFileSync(processedHookPath, Buffer.from(await hookResp.arrayBuffer()));

    // 6. Process Script with Slicr (with calculated target and optional music)
    onStatusUpdate({ status: 'processing_audio', message: 'Processing script with Slicr...' });
    const scriptS3Key = await uploadToSlicr(scriptAudioPath, 'audio/mpeg');
    const scriptSlicrParams = {
        transcribe: false,
        exportFormat: 'mp3',
        thresholdDb: slicrSettings.thresholdDb,
        minDuration: slicrSettings.minDuration,
        padding: slicrSettings.rightPadding,
        addBackgroundMusic: slicrSettings.addBackgroundMusic,
        ...(slicrSettings.addBackgroundMusic ? {
            musicVolumeDb: slicrSettings.musicVolumeDb,
            customMusicUrl: slicrSettings.customMusicUrl
        } : {}),
        ...(scriptTargetDuration ? { targetDuration: scriptTargetDuration } : {})
    };
    const scriptSlicrResult = await processWithSlicr(scriptS3Key, scriptSlicrParams);
    if (!scriptSlicrResult.success) throw new Error(`Slicr Script failed: ${scriptSlicrResult.error}`);

    const processedScriptPath = path.join(audioDir, `${timestamp}-script-processed.mp3`);
    const scriptResp = await fetch(scriptSlicrResult.audioUrl);
    fs.writeFileSync(processedScriptPath, Buffer.from(await scriptResp.arrayBuffer()));

    // 5. Local Transcription
    onStatusUpdate({ status: 'transcribing', message: 'Transcribing script locally...' });
    const wordTimings = await transcribeAudio(
        processedScriptPath,
        finalElevenlabsApiKey,
        finalOpenaiApiKey,
        finalCaptionStyle.style
    );

    // Rainbow Colors
    if (finalCaptionStyle.rainbow_text && wordTimings?.length) {
        // Vibrant HSL colors for better visibility
        const RAINBOW = [
            '#FF5F5F', // Bright Red
            '#FFC043', // Bright Orange/Yellow
            '#33D17A', // Bright Green
            '#3584E4', // Bright Blue
            '#9141AC', // Bright Purple
            '#F66151', // Salmon
            '#8FF0A4', // Pale Green
            '#99C1F1'  // Pale Blue
        ];

        let lastColorIndex = -1;

        wordTimings.forEach(w => {
            // Always color every word with rainbow - rotate through colors
            let colorIndex;
            do {
                colorIndex = Math.floor(Math.random() * RAINBOW.length);
            } while (colorIndex === lastColorIndex); // Avoid same color twice in a row

            w.color = RAINBOW[colorIndex];
            lastColorIndex = colorIndex;
        });
    }

    // 6. Render Video
    onStatusUpdate({ status: 'rendering', message: 'Rendering video...' });

    // Calculate Durations
    const hookDuration = await getAudioDuration(processedHookPath);
    const scriptDuration = await getAudioDuration(processedScriptPath);
    const totalDuration = hookDuration + scriptDuration;
    const fps = 30;
    const durationInFrames = Math.ceil(totalDuration * fps);

    // Validate durations to prevent "Invalid array length" errors
    if (!hookDuration || !scriptDuration || isNaN(hookDuration) || isNaN(scriptDuration)) {
        throw new Error(`Invalid audio durations: hook=${hookDuration}, script=${scriptDuration}`);
    }
    if (durationInFrames <= 0 || isNaN(durationInFrames)) {
        throw new Error(`Invalid durationInFrames: ${durationInFrames} (totalDuration=${totalDuration})`);
    }

    console.log(`[VideoService] Durations: hook=${hookDuration}s, script=${scriptDuration}s, total=${totalDuration}s, frames=${durationInFrames}`);

    // Get Background Videos
    const s3Backgrounds = await getS3BackgroundVideos(background_video_type || 'cooking', totalDuration + 5, fps);

    const outputPath = path.join(publicDir, 'videos', `video-${timestamp}.mp4`);

    onStatusUpdate({ status: 'rendering', message: 'Rendering video locally...' });

    // Plain caption color applies when rainbow is off (same as the main generation endpoint)
    if (!finalCaptionStyle.rainbow_text && wordTimings?.length) {
        wordTimings.forEach(w => { w.color = w.color || finalCaptionStyle.color; });
    }

    const inputProps = {
        // Hook props
        audioUrl: processedHookPath,
        audioDurationInSeconds: hookDuration,
        channelName,
        channelImage: channelImageUrl,
        hookText: hook,
        hook_animation_type: hook_animation_type || 'fall',

        // Script/Subtitle props
        scriptAudioUrl: processedScriptPath,
        scriptAudioDurationInSeconds: scriptDuration,
        subtitleText: script,
        // Fill gaps between words so no frame is left without a caption
        wordTimings: sanitizeWordTimings(wordTimings, fps) || [],
        totalDurationInFrames: durationInFrames,

        // Styling props
        font: finalCaptionStyle.font || 'Roboto',
        fontUrl: finalCaptionStyle.fontUrl,
        subtitle_size: finalCaptionStyle.subtitle_size || 64,
        stroke_size: finalCaptionStyle.stroke_size || 8,
        hookStyle: hookStylePreset || null,
        captionAnimation: finalCaptionStyle.caption_animation_type,
        captionLook: finalCaptionStyle.look,

        backgroundVideoPath: s3Backgrounds || [],

        // Dual audio mode
        isSingleAudioBlock: false,
        hookSplitTime: 0,

        visual_filter: visualFilter
    };

    await renderVideo(inputProps, {
        outputPath,
        onProgress: ({ stage, progress }) => {
            if (stage === 'rendering') onStatusUpdate({ status: 'rendering', message: `Rendering: ${Math.round(progress * 100)}%` });
        }
    });
    const actualVideoUrl = `/videos/${path.basename(outputPath)}`;

    onStatusUpdate({ status: 'complete', message: 'Video generation complete' });

    return {
        videoUrl: actualVideoUrl,
        duration: totalDuration,
        thumbnailUrl: '', // Generate thumb if needed
        videoId: `gen-${timestamp}`
    };
}

