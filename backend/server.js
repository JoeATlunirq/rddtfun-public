// Force update
import express from 'express';
import os from 'os';
import crypto from 'crypto';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exec, execFile, execSync } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// AWS S3 SDK
import { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Import services
import { trendyBotService } from './services/trendyBotService.js';
import { slicerService } from './services/slicerService.js';
import { cronJobService } from './services/cronJobService.js';
import { createResearchService } from './services/researchService.js';
import { createAuraService } from './services/auraService.js';

// Local video renderer (Skia + FFmpeg)
import { renderVideo } from './render/index.js';
import { createLongformRouter } from './routes/longform.js';
import { createPublicInviteRouter, createScriptsRouter, createTeamRouter, TEAM_ONLY_PATHS } from './routes/team.js';
import { createTeamService } from './services/teamService.js';
import { resolveTeamStore } from './services/teamStore.js';
import { getLandscapeBackgroundVideos as pickClipsByDuration } from './services/backgroundLibrary.js';
import { captionLookFromStyle } from './render/styles.js';

// Import audio utilities and prompts
import {
    generateAudio,
    transcribeAudio,
    processAudio,
    prepareAudio,
    applyAudioSpeed,
    cleanupFiles,
    getAudioDuration,
    getAudioSampleRate,
    applyTimeStretch,
    generateFishAudio,
    normalizeAudio,
    removeSilence,
    generateAudioInBatches,
    ELEVENLABS_MODEL_ID
} from './utils/audioUtils.js';

// Import Slicr utils
import { uploadToSlicr, processWithSlicr } from './utils/slicrUtils.js';

// Vibi TTS provider
import { generateVibiAudio, listVibiVoices, listVibiModels, isVibiConfigured } from './services/vibiService.js';

// Local TTS (Pocket TTS server in backend/local-tts, voice cloning)
import { synthesizeLong, listLocalVoices, transcribeWithLocal, DEFAULT_LOCAL_TTS_URL } from './services/localTtsService.js';

/**
 * True when Supabase rejected a query because a column does not exist.
 * Lets the new Vibi/Groq columns be optional, so this code runs correctly
 * whether or not the accompanying migration has been applied yet.
 */
function isMissingColumnError(error) {
    if (!error) return false;
    const code = error.code || '';
    return code === '42703' || code === 'PGRST204' || code === 'PGRST202'
        || /column .* does not exist/i.test(error.message || '');
}

// Import auth utilities
import { validateActiveUser } from './utils/authUtils.js';
import { deriveHookSplitTime, getSpeedFactorForMaximum, selectTargetDuration } from './utils/durationUtils.js';
import { sanitizeWordTimings } from './utils/captionUtils.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize dotenv
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// AWS S3 Configuration
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

/**
 * Get background videos from S3 bucket
 * @param {string} category - Video category (cooking, satisfying, gameplay)
 * @param {number} targetDuration - Target duration in seconds
 * @param {number} fps - Frames per second
 * @returns {Promise<Array>} Array of video objects with path and duration
 */
async function getS3BackgroundVideos(category, targetDuration, fps) {
    if (!s3Client) {
        console.log('S3 client not configured, skipping S3 background videos');
        return null;
    }

    // Fallback categories if gameplay is empty or requested category has no videos
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

            // Filter for .mp4 files only
            const maxVideoBytes = (Number(process.env.MAX_BACKGROUND_VIDEO_MB) || 20) * 1024 * 1024;
            const videoFiles = contents
                .filter(obj => obj.Key && obj.Key.toLowerCase().endsWith('.mp4') && (obj.Size || 0) <= maxVideoBytes)
                .map(obj => ({
                    key: obj.Key,
                    url: `${S3_BASE_URL}/${obj.Key}`
                }));

            console.log(`Found ${videoFiles.length} background videos in S3 bucket (${cat})`);

            if (videoFiles.length === 0) {
                console.log(`No videos found in ${cat}, trying next category...`);
                continue;
            }

            // Shuffle videos
            const shuffled = [...videoFiles];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            // Build video sequence to fill target duration
            const videoSequence = [];
            let accumulatedDuration = 0;

            const probeVideo = async (video) => {
                try {
                    // Use ffprobe to get duration from S3 URL (ffprobe supports HTTP URLs)
                    const { stdout } = await execFileAsync('ffprobe', [
                        '-v', 'error',
                        '-rw_timeout', '8000000',
                        '-show_entries', 'format=duration',
                        '-of', 'default=noprint_wrappers=1:nokey=1',
                        video.url
                    ], { timeout: 10000 });
                    const duration = parseFloat(stdout);
                    return Number.isFinite(duration) && duration > 0 ? { video, duration } : null;
                } catch {
                    console.warn(`Skipping unavailable background video: ${video.key}`);
                    return null;
                }
            };

            const candidates = shuffled.slice(0, 64);
            for (let offset = 0; offset < candidates.length && accumulatedDuration < targetDuration; offset += 8) {
                const results = await Promise.all(candidates.slice(offset, offset + 8).map(probeVideo));
                for (const result of results) {
                    if (!result || accumulatedDuration >= targetDuration) continue;
                    const { video, duration } = result;
                    videoSequence.push({
                        path: video.url,
                        durationInSeconds: duration,
                        durationInFrames: Math.ceil(duration * fps)
                    });
                    accumulatedDuration += duration;
                    console.log(`Added S3 background video: ${path.basename(video.key)} (${duration.toFixed(2)}s)`);
                }
            }

            if (videoSequence.length > 0) {
                console.log(`S3 background video sequence ready: ${videoSequence.length} videos, total ${accumulatedDuration.toFixed(2)}s`);
                return videoSequence;
            }
        } catch (error) {
            console.error(`Error listing S3 videos for ${cat}:`, error.message);
        }
    }

    return null;
}

/**
 * Pick background clips from a local library folder (BACKGROUND_CLIPS_DIR or
 * backend/public/background-videos). The renderer probes and caches clips itself, so this only
 * shuffles file paths. Returns null when no local clips exist so S3 can be used instead.
 */
function getLocalBackgroundVideos(customDir, targetDuration) {
    const dir = customDir || process.env.BACKGROUND_CLIPS_DIR || path.join(__dirname, 'public', 'background-videos');
    if (!dir || !fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
        .filter(file => /\.(mp4|mov|webm)$/i.test(file))
        .map(file => path.join(dir, file));
    if (files.length === 0) return null;
    for (let i = files.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [files[i], files[j]] = [files[j], files[i]];
    }
    // Clips are typically a few seconds long; one per ~3s of video is plenty (the renderer loops if short).
    const count = Math.min(files.length, Math.max(1, Math.ceil(targetDuration / 3)));
    console.log(`[VideoGen] Using ${count} local background clips from ${dir}`);
    return files.slice(0, count);
}

/**
 * Stitch multiple background videos into a single file
 * @param {Array} videoSequence - Array of video objects with url/path
 * @param {string} outputPath - Path for the stitched output file
 * @returns {Promise<string>} Path to stitched video
 */
async function stitchBackgroundVideos(videoSequence, outputPath) {
    console.log(`[Stitch] Starting stitch of ${videoSequence.length} videos...`);

    const tempDir = path.join(__dirname, 'public', 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const concatFile = path.join(tempDir, `concat-${Date.now()}.txt`);
    const downloadedFiles = [];

    try {
        // Step 1: Download all videos from S3 to local temp files
        for (let i = 0; i < videoSequence.length; i++) {
            const video = videoSequence[i];
            const tempVideoPath = path.join(tempDir, `temp-${Date.now()}-${i}.mp4`);

            console.log(`[Stitch] Downloading video ${i + 1}/${videoSequence.length} from ${video.path}`);

            // Download from S3 URL
            const response = await fetch(video.path);
            if (!response.ok) {
                throw new Error(`Failed to download ${video.path}: ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();
            fs.writeFileSync(tempVideoPath, Buffer.from(buffer));
            downloadedFiles.push(tempVideoPath);

            console.log(`[Stitch] Downloaded to ${tempVideoPath}`);
        }

        // Step 2: Create concat file for FFmpeg
        let concatContent = '';
        for (const file of downloadedFiles) {
            // Escape single quotes in path for FFmpeg
            const escapedPath = file.replace(/'/g, "'\\''");
            concatContent += `file '${escapedPath}'\n`;
        }
        fs.writeFileSync(concatFile, concatContent);
        console.log(`[Stitch] Created concat file with ${downloadedFiles.length} entries`);

        // Step 3: Stitch using FFmpeg concat demuxer
        console.log(`[Stitch] Running FFmpeg to stitch videos...`);
        await execAsync(
            `ffmpeg -f concat -safe 0 -i "${concatFile}" -c copy "${outputPath}"`,
            { maxBuffer: 50 * 1024 * 1024 } // 50MB buffer for FFmpeg output
        );
        console.log(`[Stitch] Stitched video created: ${outputPath}`);

        return outputPath;
    } finally {
        // Cleanup: Remove concat file and downloaded temp files
        try {
            if (fs.existsSync(concatFile)) {
                fs.unlinkSync(concatFile);
            }
            for (const file of downloadedFiles) {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            }
        } catch (err) {
            console.error('[Stitch] Cleanup error:', err.message);
        }
    }
}

// Supabase Configuration (optional)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = (supabaseUrl && supabaseServiceKey)
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;
const researchService = supabase ? createResearchService({ supabase }) : null;
const auraService = researchService
    ? createAuraService({ supabase, research: researchService, dataDir: path.join(__dirname, 'data'), isMissingColumnError })
    : null;
// Team members + Script board (Supabase tables, or backend/data/team_scripts.json until migrated)
let teamStore = null;
const teamService = createTeamService({
    // Resolved on first use; retried if Supabase could not be reached
    store: () => (teamStore ||= resolveTeamStore({ supabase, file: path.join(__dirname, 'data', 'team_scripts.json') })
        .catch(error => { teamStore = null; throw error; })),
    listChannelProfiles: async ownerId => {
        if (!supabase) return readJsonFile(profilesFile).filter(p => p.user_id === ownerId).map(({ id, name, image_url }) => ({ id, name, image_url }));
        const { data, error } = await supabase.from('channel_profiles').select('id, name, image_url').eq('user_id', ownerId);
        if (error) throw error;
        return data || [];
    },
});


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const configuredOrigins = [
    process.env.APP_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null,
    ...(process.env.ALLOWED_ORIGINS || '').split(',')
].map(origin => origin?.trim()).filter(Boolean);
const allowedOrigins = new Set(configuredOrigins);
const isRailwayOrigin = (origin) => /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i.test(origin || '');
app.use(cors({
    origin(origin, callback) {
        const isLocalDevelopment = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
        if (!origin || isLocalDevelopment || isRailwayOrigin(origin) || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed'));
    }
}));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// Serve static files
const publicDir = path.join(__dirname, 'public');
app.use('/videos', express.static(path.join(publicDir, 'videos')));
app.use('/audio', express.static(path.join(publicDir, 'audio')));
app.use('/images', express.static(path.join(publicDir, 'images')));
app.use('/fonts', express.static(path.join(publicDir, 'fonts')));
app.use('/assets', express.static(path.join(publicDir, 'assets')));
app.use('/background-videos', express.static(path.join(publicDir, 'background-videos')));
app.use('/background-music', express.static(path.join(publicDir, 'background-music')));
app.use('/remotion-public', express.static(path.join(__dirname, 'remotion/public')));

// Ensure directories exist
const videosDir = path.join(publicDir, 'videos');
const audioDir = path.join(publicDir, 'audio');
const imagesDir = path.join(publicDir, 'images');
const thumbnailsDir = path.join(publicDir, 'images', 'thumbnails');
const dataDir = path.join(__dirname, 'data');

[videosDir, audioDir, imagesDir, thumbnailsDir, dataDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Data file paths
const videosFile = path.join(dataDir, 'videos.json');
const cronJobsFile = path.join(dataDir, 'cron_jobs.json');
const presetsFile = path.join(dataDir, 'presets.json');
const settingsFile = path.join(dataDir, 'settings.json');
const profilesFile = path.join(dataDir, 'profiles.json');
const videoGenerationFile = path.join(dataDir, 'video_generation.json');
const recentTopicsFile = path.join(dataDir, 'recent_topics.json');

const MAX_RECENT_TOPICS = 20;

// Helper functions for data persistence
function readJsonFile(filePath, defaultValue = []) {
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
    }
    return defaultValue;
}

function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        throw error;
    }
}

// Helper to get recent topics
function getRecentTopics() {
    try {
        if (fs.existsSync(recentTopicsFile)) {
            const data = fs.readFileSync(recentTopicsFile, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error reading recent topics:', error);
    }
    return [];
}

// Helper to save a used topic
function saveUsedTopic(topic) {
    try {
        let recentTopics = getRecentTopics();
        recentTopics.push(topic);
        if (recentTopics.length > MAX_RECENT_TOPICS) {
            recentTopics = recentTopics.slice(-MAX_RECENT_TOPICS);
        }
        fs.writeFileSync(recentTopicsFile, JSON.stringify(recentTopics, null, 2));
    } catch (error) {
        console.error('Error saving used topic:', error);
    }
}

// Helper to select a random topic that hasn't been used recently
function selectRandomTopic(allTopics) {
    const recentTopics = getRecentTopics();
    const availableTopics = allTopics.filter(topic => !recentTopics.includes(topic));
    const topicsToChooseFrom = availableTopics.length > 0 ? availableTopics : allTopics;
    const randomIndex = Math.floor(Math.random() * topicsToChooseFrom.length);
    const selectedTopic = topicsToChooseFrom[randomIndex];
    saveUsedTopic(selectedTopic);
    console.log(`[Topic Selection] Available: ${topicsToChooseFrom.length}/${allTopics.length}, Selected: ${selectedTopic}`);
    return selectedTopic;
}

// Helper to generate thumbnail
async function generateThumbnail(videoPath, videoId) {
    const thumbnailFilename = `${videoId}-thumbnail.jpg`;
    const thumbnailPath = path.join(thumbnailsDir, thumbnailFilename);

    if (fs.existsSync(thumbnailPath)) {
        return `/images/thumbnails/${thumbnailFilename}`;
    }

    try {
        await execAsync(`ffmpeg -i "${videoPath}" -ss 00:00:01.000 -vframes 1 "${thumbnailPath}"`);
        return `/images/thumbnails/${thumbnailFilename}`;
    } catch (error) {
        console.error('Error generating thumbnail:', error);
        return '';
    }
}

// Helper to get user settings
function getLocalSettings(userId) {
    try {
        if (fs.existsSync(settingsFile)) {
            const data = fs.readFileSync(settingsFile, 'utf8');
            const allSettings = JSON.parse(data);
            return allSettings[userId] || {};
        }
    } catch (error) {
        console.error('Error reading settings file:', error);
    }
    return {};
}

// Helper to save user settings
function saveLocalSettings(userId, settings) {
    try {
        let allSettings = {};
        if (fs.existsSync(settingsFile)) {
            const data = fs.readFileSync(settingsFile, 'utf8');
            allSettings = JSON.parse(data);
        }

        // Normalize keys to snake_case for consistency
        const normalizedSettings = {
            elevenlabs_api_key: settings.elevenlabsApiKey || settings.elevenlabs_api_key,
            fish_audio_api_key: settings.fishAudioApiKey || settings.fish_audio_api_key,
            telegram_user_id: settings.telegramUserId || settings.telegram_user_id,
            vibi_api_key: settings.vibiApiKey || settings.vibi_api_key,
            groq_api_key: settings.groqApiKey || settings.groq_api_key,
            local_tts_url: settings.localTtsUrl || settings.local_tts_url,
            local_tts_api_key: settings.localTtsApiKey || settings.local_tts_api_key,
            updated_at: new Date().toISOString()
        };

        allSettings[userId] = { ...allSettings[userId], ...normalizedSettings };
        fs.writeFileSync(settingsFile, JSON.stringify(allSettings, null, 2));
        console.log(`[Local] Saved settings for user ${userId}`);
    } catch (error) {
        console.error('Error saving settings file:', error);
        throw error;
    }
}

// Helper to save local profiles
function saveLocalProfiles(userId, profiles) {
    try {
        let allProfiles = {};
        if (fs.existsSync(profilesFile)) {
            const data = fs.readFileSync(profilesFile, 'utf8');
            allProfiles = JSON.parse(data);
        }
        allProfiles[userId] = profiles;
        fs.writeFileSync(profilesFile, JSON.stringify(allProfiles, null, 2));
        console.log(`Saved ${profiles.length} profiles for user ${userId}`);
    } catch (error) {
        console.error('Error saving profiles file:', error);
        throw error;
    }
}

// Helper to save video metadata
async function saveVideoToSupabase(videoData) {
    if (supabase) {
        try {
            const { error } = await supabase
                .from('videos')
                .upsert({
                    id: videoData.id,
                    user_id: videoData.userId || videoData.user_id,
                    profile_id: videoData.profileId || videoData.profile_id,
                    title: videoData.title,
                    hook_text: videoData.hook || videoData.hook_text,
                    script_text: videoData.script || videoData.script_text,
                    thumbnail_url: videoData.thumbnail_url,
                    video_url: videoData.video_url,
                    duration: videoData.duration,
                    status: videoData.status || 'completed',
                    created_at: videoData.createdAt || new Date().toISOString()
                });

            if (error) throw error;
            console.log('[Supabase] Saved video metadata:', videoData.id);
            return true;
        } catch (error) {
            console.error('[Supabase] Error saving video:', error);
        }
    }

    // Fallback to local file
    try {
        let videos = [];
        if (fs.existsSync(videosFile)) {
            const data = fs.readFileSync(videosFile, 'utf8');
            videos = JSON.parse(data);
        }
        const existingIndex = videos.findIndex(v => v.id === videoData.id);
        if (existingIndex >= 0) {
            videos[existingIndex] = { ...videos[existingIndex], ...videoData };
        } else {
            videos.push(videoData);
        }
        fs.writeFileSync(videosFile, JSON.stringify(videos, null, 2));
        console.log('Saved video metadata locally:', videoData.id);
    } catch (error) {
        console.error('Error saving video metadata:', error);
    }
}

// S3 Upload Helper for Lambda Rendering
async function uploadToS3(filePath, s3Key, signed = false) {
    if (!s3Client) {
        throw new Error('S3 client not configured');
    }

    const fileContent = fs.readFileSync(filePath);
    const bucketName = process.env.AWS_BUCKET_NAME || 'rddtfun';

    const contentType = s3Key.endsWith('.mp3') ? 'audio/mpeg' :
        s3Key.endsWith('.wav') ? 'audio/wav' :
            s3Key.endsWith('.jpg') || s3Key.endsWith('.part') ? 'image/jpeg' : // .part for partial uploads
                s3Key.endsWith('.png') ? 'image/png' : 'application/octet-stream';

    await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: fileContent,
        ContentType: contentType,
    }));

    if (signed) {
        return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucketName, Key: s3Key }), { expiresIn: 3600 });
    }

    return `https://${bucketName}.s3.${process.env.AWS_BUCKET_REGION || 'us-east-1'}.amazonaws.com/${s3Key}`;
}

async function getSignedAssetUrl(assetUrl) {
    if (!assetUrl || !s3Client) return assetUrl;
    try {
        const parsed = new URL(assetUrl);
        const bucketName = process.env.AWS_BUCKET_NAME || 'rddtfun';
        const expectedHost = `${bucketName}.s3.${process.env.AWS_BUCKET_REGION || 'us-east-1'}.amazonaws.com`;
        if (parsed.hostname !== expectedHost) return assetUrl;
        const key = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
        return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucketName, Key: key }), { expiresIn: 3600 });
    } catch {
        return assetUrl;
    }
}

// Main video rendering function
async function renderHookVideo(
    hookAudioPath, scriptAudioPath, channelName, channelImageUrl, hookText, scriptText,
    outputPath, openaiApiKey, elevenlabsApiKey, channelStyle = 'grouped', font = 'Jellee',
    fontUrl = null, has_background_music = false, background_music_volume = 0.08,
    backgroundMusicUrl = null,
    subtitle_size = 64, stroke_size = 8, res, filesToCleanup, background_video_type = 'gameplay',
    userId, timestamp, openrouterApiKey = null, hook_animation_type = 'fall',
    customVideoPath = null, precomputedWordTimings = null, scriptColors = null,
    isSingleAudioBlock = false, hookSplitTime = 0, hookStyle = null,
    hookWordTimings = [], // New arg: Hook captions
    captionAnimationType = 'scale', // New arg: Caption Animation
    visualFilter = 'none',
    captionLook = null // Caption case/shadow/position/highlights from the caption preset
) {
    // Map 'satisfying' to 'satisfying-compound' to use optimized clips
    if (background_video_type === 'satisfying') {
        background_video_type = 'satisfying-compound';
        console.log('[VideoGen] Remapped satisfying -> satisfying-compound');
    }

    try {
        const fps = 30;

        // 1. Durations
        let hookDurationInSeconds, scriptDurationInSeconds, totalDurationInSeconds;
        if (isSingleAudioBlock) {
            console.log(`[VideoGen] Using Single Audio Block logic. Split time: ${hookSplitTime}s`);
            totalDurationInSeconds = await getAudioDuration(hookAudioPath);
            hookDurationInSeconds = hookSplitTime;
            scriptDurationInSeconds = Math.max(0, totalDurationInSeconds - hookDurationInSeconds);
        } else {
            hookDurationInSeconds = await getAudioDuration(hookAudioPath);
            scriptDurationInSeconds = await getAudioDuration(scriptAudioPath);
            totalDurationInSeconds = hookDurationInSeconds + scriptDurationInSeconds;
        }
        if (![hookDurationInSeconds, scriptDurationInSeconds].every(Number.isFinite) || totalDurationInSeconds <= 0) {
            throw new Error(`Invalid audio durations: hook=${hookDurationInSeconds}, script=${scriptDurationInSeconds}`);
        }

        // 2. Word timings
        let wordTimings = precomputedWordTimings;
        if (!wordTimings) {
            try {
                wordTimings = await transcribeAudio(scriptAudioPath, elevenlabsApiKey, openaiApiKey, channelStyle, openrouterApiKey);
            } catch (error) {
                console.error('Transcription failed, using fallback:', error);
                const words = scriptText.split(' ').filter(w => w.trim());
                const framesPerWord = Math.floor((scriptDurationInSeconds * fps) / words.length);
                wordTimings = words.map((word, i) => ({
                    text: word,
                    startFrame: i * framesPerWord,
                    endFrame: (i + 1) * framesPerWord,
                    color: 'white'
                }));
            }
        }
        res.write(JSON.stringify({ type: 'status_update', status: 'transcription_complete' }) + '\n\n');

        // 3. Background clips: local library first, then S3
        const backgroundVideos = getLocalBackgroundVideos(customVideoPath, totalDurationInSeconds)
            || await getS3BackgroundVideos(background_video_type, totalDurationInSeconds, fps).catch(error => {
                console.error('Error getting S3 background videos:', error.message);
                return null;
            })
            || [];
        console.log(`[VideoGen] Using ${backgroundVideos.length} background clips`);

        // 4. Render locally (Skia + FFmpeg)
        const inputProps = {
            channelName,
            channelImage: channelImageUrl,
            hookText,
            audioUrl: hookAudioPath,
            audioDurationInSeconds: hookDurationInSeconds,
            hook_animation_type,
            subtitleText: scriptText,
            scriptAudioUrl: scriptAudioPath,
            scriptAudioDurationInSeconds: scriptDurationInSeconds,
            wordTimings: sanitizeWordTimings(wordTimings, fps) || [],
            totalDurationInFrames: Math.ceil(totalDurationInSeconds * fps),
            backgroundVideoPath: backgroundVideos,
            font,
            fontUrl,
            has_background_music,
            background_music_volume,
            backgroundMusicUrl,
            subtitle_size,
            stroke_size,
            isSingleAudioBlock,
            hookSplitTime,
            hookStyle: hookStyle || null,
            hookWordTimings: sanitizeWordTimings(hookWordTimings, fps) || [],
            captionAnimation: (typeof captionAnimationType === 'string') ? captionAnimationType : 'scale',
            captionLook,
            visual_filter: visualFilter,
        };

        res.write(JSON.stringify({ type: 'status_update', status: 'video_processing', progress: 0, message: 'Preparing assets...' }) + '\n\n');
        let lastReported = -1;
        await renderVideo(inputProps, {
            outputPath,
            onProgress: ({ stage, progress }) => {
                const overall = stage === 'rendering' ? 10 + progress * 85
                    : stage === 'finalizing' ? 95 + progress * 5
                        : progress * 10;
                const p = Math.floor(overall);
                if (p === lastReported) return;
                lastReported = p;
                res.write(JSON.stringify({ type: 'step_progress', stepId: 'video_generation', progress: p }) + '\n\n');
            }
        });
        console.log('Render complete:', outputPath);

        // 5. Thumbnail
        const thumbnailPath = path.join(imagesDir, `thumbnail-${timestamp}.jpg`);
        try {
            await execFileAsync('ffmpeg', ['-y', '-i', outputPath, '-ss', '00:00:01', '-frames:v', '1', thumbnailPath]);
        } catch (e) {
            console.error('Thumbnail generation failed:', e.message);
        }

        const videoUrl = `/videos/${path.basename(outputPath)}`;
        return {
            videoUrl,
            thumbnailUrl: `/images/${path.basename(thumbnailPath)}`,
            hookAudio: `/audio/${path.basename(hookAudioPath)}`,
            scriptAudio: `/audio/${path.basename(scriptAudioPath)}`,
            hookVideo: videoUrl
        };
    } catch (error) {
        console.error('Error in renderHookVideo:', error);
        throw error;
    }
}

// ============================================
// API ENDPOINTS
// ============================================

app.post('/api/auth/signup', async (req, res) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Authentication service is not configured' });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const signupCode = String(req.body.signupCode || '').trim();
    const inviteToken = String(req.body.inviteToken || '').trim();

    // Team invite link: makes a team-only account (Script board only) instead of using a signup code
    if (inviteToken) {
        if (!email || password.length < 8) {
            return res.status(400).json({ error: 'Email and an 8-character password are required' });
        }
        const invite = await teamService.getInvite(inviteToken).catch(() => null);
        if (!invite) return res.status(400).json({ error: 'This invite link is invalid or was already used' });
        if (invite.email !== email) return res.status(400).json({ error: `This invite is for ${invite.email}` });

        const { data: userData, error: createError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            app_metadata: { team_only: true }
        });
        if (createError || !userData.user) {
            return res.status(400).json({ error: createError?.message || 'Unable to create account' });
        }
        try {
            await teamService.acceptInvite({ id: userData.user.id, email, teamOnly: true }, inviteToken);
        } catch (error) {
            await supabase.auth.admin.deleteUser(userData.user.id);
            return res.status(409).json({ error: error.message || 'Invite is no longer available' });
        }
        return res.status(201).json({ success: true });
    }

    if (!email || password.length < 8 || !signupCode) {
        return res.status(400).json({ error: 'Email, an 8-character password, and signup code are required' });
    }

    const { data: invite, error: inviteError } = await supabase
        .from('signup_codes')
        .select('id, current_uses, max_uses, expires_at')
        .eq('code', signupCode)
        .maybeSingle();

    if (
        inviteError ||
        !invite ||
        invite.current_uses >= invite.max_uses ||
        (invite.expires_at && new Date(invite.expires_at) <= new Date())
    ) {
        return res.status(400).json({ error: 'Invalid or expired signup code' });
    }

    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    });

    if (createError || !userData.user) {
        return res.status(400).json({ error: createError?.message || 'Unable to create account' });
    }

    const { data: claimed, error: claimError } = await supabase.rpc('consume_signup_code', {
        invite_code: signupCode
    });

    if (claimError || !claimed) {
        await supabase.auth.admin.deleteUser(userData.user.id);
        return res.status(409).json({ error: 'Signup code is no longer available' });
    }

    await supabase.from('user_settings').insert({ user_id: userData.user.id });
    return res.status(201).json({ success: true });
});

// Signed-out invite preview for the /join page (must stay above the auth middleware)
app.use('/api/team-invites', createPublicInviteRouter(teamService));

app.use('/api', async (req, res, next) => {
    if (req.path === '/health' || req.path === '/auth/signup') return next();
    if (!supabase) return res.status(503).json({ error: 'Authentication service is not configured' });

    const authorization = req.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });

    req.authUser = data.user;
    // Accounts made from a team invite only reach the Script board and team endpoints
    if (data.user.app_metadata?.team_only === true && !TEAM_ONLY_PATHS.test(req.path)) {
        return res.status(403).json({ error: 'Team accounts can only use the Script board' });
    }
    if (req.body?.userId && req.body.userId !== data.user.id) {
        return res.status(403).json({ error: 'User ID does not match the authenticated account' });
    }
    if (req.query?.userId && req.query.userId !== data.user.id) {
        return res.status(403).json({ error: 'User ID does not match the authenticated account' });
    }
    if (req.body) req.body.userId = data.user.id;
    next();
});

// Team members/roles and the Script board (see backend/routes/team.js)
app.use('/api/team', createTeamRouter(teamService));
app.use('/api/scripts', createScriptsRouter(teamService));

// Long-form video + linked promo short (background jobs, see backend/routes/longform.js)
app.use('/api/longform', createLongformRouter({
    supabase,
    dataDir,
    publicDir,
    getLocalSettings,
    saveVideo: saveVideoToSupabase,
    // PROMO_CLIPS_DIR: local folder of long vertical gameplay clips for the promo short; picked by
    // duration (the generic short picker assumes many few-second clips).
    getShortBackgrounds: async (category, seconds) => (process.env.PROMO_CLIPS_DIR
        ? await pickClipsByDuration(seconds, { dir: process.env.PROMO_CLIPS_DIR })
        : getLocalBackgroundVideos(null, seconds) || await getS3BackgroundVideos(category, seconds, 30))
        || [],
    landscapeLibrary: { s3Client, bucket: S3_BUCKET_NAME, baseUrl: S3_BASE_URL },
}));

app.get('/api/research/config', async (req, res) => {
    try {
        res.json(await researchService.getConfig(req.authUser.id));
    } catch (error) {
        console.error('[Research] Failed to load configuration:', error.message);
        res.status(500).json({ error: 'Failed to load research configuration' });
    }
});

app.put('/api/research/youtube-keys', async (req, res) => {
    try {
        const { primary, backup } = req.body;
        if ([primary, backup].some(value => value !== undefined && typeof value !== 'string')) {
            return res.status(400).json({ error: 'API keys must be strings' });
        }
        if ([primary, backup].some(value => typeof value === 'string' && value.length > 256)) {
            return res.status(400).json({ error: 'API key is too long' });
        }
        await researchService.saveYoutubeKeys(req.authUser.id, primary, backup);
        res.json(await researchService.getConfig(req.authUser.id));
    } catch (error) {
        console.error('[Research] Failed to save YouTube keys:', error.message);
        res.status(500).json({ error: 'Failed to save YouTube API keys' });
    }
});

app.get('/api/research/groups', async (req, res) => {
    try {
        res.json({ groups: await researchService.listGroups(req.authUser.id) });
    } catch (error) {
        console.error('[Research] Failed to list groups:', error.message);
        res.status(500).json({ error: 'Failed to load research groups' });
    }
});

app.post('/api/research/groups', async (req, res) => {
    try {
        const group = await researchService.createGroup(req.authUser.id, req.body.name);
        res.status(201).json({ group });
    } catch (error) {
        console.error('[Research] Failed to create group:', error.message);
        res.status(400).json({ error: error.message || 'Failed to create research group' });
    }
});

app.put('/api/research/groups/:id', async (req, res) => {
    try {
        const group = await researchService.renameGroup(req.authUser.id, req.params.id, req.body.name);
        res.json({ group });
    } catch (error) {
        console.error('[Research] Failed to rename group:', error.message);
        res.status(400).json({ error: error.message || 'Failed to rename research group' });
    }
});

app.delete('/api/research/groups/:id', async (req, res) => {
    try {
        await researchService.removeGroup(req.authUser.id, req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('[Research] Failed to remove group:', error.message);
        res.status(500).json({ error: 'Failed to remove research group' });
    }
});

app.get('/api/research/channels', async (req, res) => {
    try {
        res.json({ channels: await researchService.listChannels(req.authUser.id, req.query.groupId) });
    } catch (error) {
        console.error('[Research] Failed to list channels:', error.message);
        res.status(400).json({ error: error.message || 'Failed to load research channels' });
    }
});

app.post('/api/research/channels', async (req, res) => {
    try {
        const source = req.body.source === 'youtube' ? 'youtube' : 'viewstats';
        const identifiers = Array.isArray(req.body.identifiers) ? req.body.identifiers : [req.body.identifier];
        const result = await researchService.addChannels(req.authUser.id, req.body.groupId, identifiers, source);
        res.status(201).json(result);
    } catch (error) {
        console.error('[Research] Failed to add channels:', error.message);
        const isInputError = /enter|valid|not found|no videos|api key|not configured|group|50 channels/i.test(error.message);
        res.status(isInputError ? 400 : 502).json({ error: error.message || 'Failed to add channels' });
    }
});

app.delete('/api/research/channels/:id', async (req, res) => {
    try {
        await researchService.removeChannel(req.authUser.id, req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('[Research] Failed to remove channel:', error.message);
        res.status(500).json({ error: 'Failed to remove research channel' });
    }
});

app.post('/api/research/transcript', async (req, res) => {
    try {
        res.json(await researchService.fetchTranscript(req.body.videoId));
    } catch (error) {
        console.error('[Research] Transcript request failed:', error.message);
        const isInputError = /invalid|no transcript|not available/i.test(error.message);
        res.status(isInputError ? 400 : 502).json({ error: error.message || 'Failed to fetch transcript' });
    }
});

app.post('/api/research/run', async (req, res) => {
    try {
        const source = req.body.source || 'viewstats';
        const timeframe = req.body.timeframe || '28d';
        res.json(await researchService.runResearch(req.authUser.id, req.body.groupId, source, timeframe));
    } catch (error) {
        console.error('[Research] Research request failed:', error.message);
        const isInputError = /invalid|api key|not configured/i.test(error.message);
        res.status(isInputError ? 400 : 502).json({ error: error.message || 'Research request failed' });
    }
});

app.get('/api/aura/channels', async (req, res) => {
    try {
        res.json({ channels: await auraService.getChannels(req.authUser.id) });
    } catch (error) {
        console.error('[Aura] Failed to load channels:', error.message);
        res.status(500).json({ error: 'Failed to load Aura channels' });
    }
});

app.post('/api/aura/channels', async (req, res) => {
    try {
        res.status(201).json({ channels: await auraService.addChannel(req.authUser.id, req.body.handle) });
    } catch (error) {
        console.error('[Aura] Failed to add channel:', error.message);
        const isInputError = /enter|valid|not found|no videos|already|up to/i.test(error.message);
        res.status(isInputError ? 400 : 502).json({ error: error.message || 'Failed to add channel' });
    }
});

app.delete('/api/aura/channels/:channelId', async (req, res) => {
    try {
        res.json({ channels: await auraService.removeChannel(req.authUser.id, req.params.channelId) });
    } catch (error) {
        console.error('[Aura] Failed to remove channel:', error.message);
        res.status(500).json({ error: 'Failed to remove Aura channel' });
    }
});

app.get('/api/aura/leaderboard', async (req, res) => {
    try {
        res.json(await auraService.getLeaderboard(req.authUser.id, String(req.query.timeframe || '24h')));
    } catch (error) {
        console.error('[Aura] Leaderboard request failed:', error.message);
        res.status(/invalid/i.test(error.message) ? 400 : 502).json({ error: error.message || 'Failed to load Aura leaderboard' });
    }
});

// Stats endpoint
app.get('/api/stats', async (req, res) => {
    try {
        const userId = req.authUser.id;
        let videos = [];

        if (supabase) {
            // Fetch videos from Supabase
            const { data: videoData, error: videoError } = await supabase
                .from('videos')
                .select('duration, created_at')
                .eq('user_id', userId);

            if (videoError) throw videoError;
            videos = videoData || [];
        } else {
            // Fallback to local files
            videos = readJsonFile(videosFile).filter(v => v.user_id === userId);
        }

        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const videosThisWeek = videos.filter(v =>
            new Date(v.created_at) > weekAgo
        ).length;

        const totalDuration = videos.reduce((sum, v) => sum + (v.duration || 0), 0);

        res.json({
            totalVideos: videos.length,
            videosThisWeek,
            totalDuration,
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Videos endpoints
app.get('/api/videos', async (req, res) => {
    const { userId } = req.query;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('videos')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Map to frontend format
            const videos = await Promise.all((data || []).map(async v => ({
                id: v.id,
                userId: v.user_id,
                profileId: v.profile_id,
                title: v.title,
                hook: v.hook_text,
                script: v.script_text,
                thumbnail_url: await getSignedAssetUrl(v.thumbnail_url),
                video_url: v.video_url,
                duration: v.duration,
                status: v.status,
                createdAt: v.created_at
            })));
            return res.json(videos);
        } catch (error) {
            console.error('[Supabase] Error fetching videos:', error);
        }
    }

    // Fallback to local file
    try {
        const videos = readJsonFile(videosFile).filter(v => v.user_id === userId);
        res.json(videos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch videos' });
    }
});

app.get('/api/videos/:id', async (req, res) => {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('videos')
                .select('*')
                .eq('id', req.params.id)
                .eq('user_id', req.authUser.id)
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Video not found' });

            return res.json({
                id: data.id,
                userId: data.user_id,
                title: data.title,
                hook: data.hook_text,
                script: data.script_text,
                thumbnail_url: await getSignedAssetUrl(data.thumbnail_url),
                video_url: data.video_url,
                duration: data.duration,
                createdAt: data.created_at
            });
        } catch (error) {
            console.error('[Supabase] Error fetching video:', error);
        }
    }

    // Fallback to local
    try {
        const videos = readJsonFile(videosFile);
        const video = videos.find(v => v.id === req.params.id);
        if (!video) {
            return res.status(404).json({ error: 'Video not found' });
        }
        res.json(video);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch video' });
    }
});

// Delete a video
app.delete('/api/videos/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.query.userId;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    if (supabase) {
        try {
            // First fetch the video to verify ownership
            const { data: video, error: fetchError } = await supabase
                .from('videos')
                .select('*')
                .eq('id', id)
                .eq('user_id', userId)
                .single();

            if (fetchError || !video) {
                return res.status(404).json({ error: 'Video not found or access denied' });
            }

            // Delete from database
            const { error: deleteError } = await supabase
                .from('videos')
                .delete()
                .eq('id', id)
                .eq('user_id', userId);

            if (deleteError) throw deleteError;

            console.log(`[Video] Deleted video ${id} for user ${userId}`);
            return res.json({ success: true, message: 'Video deleted successfully' });
        } catch (error) {
            console.error('[Supabase] Error deleting video:', error);
            return res.status(500).json({ error: 'Failed to delete video' });
        }
    }

    // Fallback to local file
    try {
        const videos = readJsonFile(videosFile);
        const index = videos.findIndex(v => v.id === id && v.userId === userId);
        if (index === -1) {
            return res.status(404).json({ error: 'Video not found' });
        }
        videos.splice(index, 1);
        writeJsonFile(videosFile, videos);
        res.json({ success: true, message: 'Video deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete video' });
    }
});
app.get('/api/user-settings/:userId', async (req, res) => {
    const userId = req.authUser.id;

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('user_settings')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            res.json(data || {});
        } catch (error) {
            console.error('Error fetching settings from Supabase:', error);
            // Fall back to local
            const settings = getLocalSettings(userId);
            res.json(settings);
        }
    } else {
        const settings = getLocalSettings(userId);
        res.json(settings);
    }
});

app.post('/api/save-user-settings', async (req, res) => {
    console.log('[API] Received save-user-settings request');
    const { userId, elevenlabsApiKey, fishAudioApiKey, telegramUserId, vibiApiKey, groqApiKey, localTtsUrl, localTtsApiKey } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    // Explicitly mapping from camelCase (frontend) to snake_case (database)
    const settings = {
        elevenlabs_api_key: elevenlabsApiKey,
        fish_audio_api_key: fishAudioApiKey,
        telegram_user_id: telegramUserId,
        vibi_api_key: vibiApiKey,
        groq_api_key: groqApiKey,
        local_tts_url: localTtsUrl,
        local_tts_api_key: localTtsApiKey,
        updated_at: new Date().toISOString()
    };

    if (supabase) {
        try {
            console.log(`[Supabase] Attempting upsert for ${userId}`);
            let { error } = await supabase
                .from('user_settings')
                .upsert({
                    user_id: userId,
                    ...settings
                }, { onConflict: 'user_id' })
                .select();

            if (isMissingColumnError(error)) {
                // Migration not applied yet — save everything except the new columns.
                console.warn('[Supabase] vibi/groq/local_tts columns missing, saving without them. Run the 20260910120000 and 20261025120000 migrations to enable them.');
                const { vibi_api_key, groq_api_key, local_tts_url, local_tts_api_key, ...legacySettings } = settings;
                ({ error } = await supabase
                    .from('user_settings')
                    .upsert({ user_id: userId, ...legacySettings }, { onConflict: 'user_id' })
                    .select());
            }

            if (error) {
                console.error('[Supabase] Upsert error:', error);
                throw error;
            }
            console.log('[Supabase] User settings saved successfully');
            res.json({ success: true, saved: true, source: 'supabase' });
        } catch (error) {
            console.error('[Supabase] Fallback to local due to error');
            saveLocalSettings(userId, settings);
            res.json({ success: true, saved: true, source: 'local' });
        }
    } else {
        console.log('[API] Supabase not available, saving locally');
        saveLocalSettings(userId, settings);
        res.json({ success: true, saved: true, source: 'local' });
    }
});

// --- ElevenLabs Voices Endpoint ---
app.get('/api/elevenlabs/voices', async (req, res) => {
    try {
        const { data: settings, error: settingsError } = await supabase
            .from('user_settings')
            .select('elevenlabs_api_key')
            .eq('user_id', req.authUser.id)
            .single();
        if (settingsError) throw settingsError;
        const apiKey = settings?.elevenlabs_api_key;
        if (!apiKey) return res.status(400).json({ error: 'ElevenLabs API key is required' });
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: {
                'xi-api-key': apiKey
            }
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.statusText}`);
        }

        const data = await response.json();
        const voices = data.voices.map(v => ({
            voice_id: v.voice_id,
            name: v.name,
            category: v.category,
            labels: v.labels
        }));

        res.json({ voices });
    } catch (error) {
        console.error('Error fetching voices:', error);
        res.status(500).json({ error: 'Failed to fetch voices' });
    }
});

// --- Vibi Voices Endpoint ---
app.get('/api/vibi/voices', async (req, res) => {
    try {
        let apiKey = null;
        if (supabase) {
            const { data: settings } = await supabase
                .from('user_settings')
                .select('*')
                .eq('user_id', req.authUser.id)
                .single();
            apiKey = settings?.vibi_api_key;
        }
        if (!isVibiConfigured(apiKey)) {
            return res.status(400).json({ error: 'Vibi API key is required' });
        }
        const voices = await listVibiVoices(apiKey);
        res.json({ voices });
    } catch (error) {
        console.error('Error fetching Vibi voices:', error);
        res.status(500).json({ error: 'Failed to fetch Vibi voices' });
    }
});

// --- Vibi Models Endpoint ---
app.get('/api/vibi/models', async (req, res) => {
    try {
        let apiKey = null;
        if (supabase) {
            const { data: settings } = await supabase
                .from('user_settings')
                .select('*')
                .eq('user_id', req.authUser.id)
                .single();
            apiKey = settings?.vibi_api_key;
        }
        if (!isVibiConfigured(apiKey)) {
            return res.status(400).json({ error: 'Vibi API key is required' });
        }
        const models = await listVibiModels(apiKey);
        res.json({ models });
    } catch (error) {
        console.error('Error fetching Vibi models:', error);
        res.status(500).json({ error: 'Failed to fetch Vibi models' });
    }
});

// --- Local TTS Voices Endpoint ---
async function getLocalTtsSettings(userId) {
    const local = getLocalSettings(userId);
    let url = local.local_tts_url;
    let apiKey = local.local_tts_api_key;
    if (supabase) {
        const { data: settings } = await supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', userId)
            .single();
        url = settings?.local_tts_url || url;
        apiKey = settings?.local_tts_api_key || apiKey;
    }
    return { baseUrl: url || process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL, apiKey: apiKey || process.env.LOCAL_TTS_API_KEY || null };
}

app.get('/api/local-tts/voices', async (req, res) => {
    try {
        const { baseUrl, apiKey } = await getLocalTtsSettings(req.authUser.id);
        const voices = await listLocalVoices({ baseUrl, apiKey });
        res.json({ voices, baseUrl });
    } catch (error) {
        console.error('Error fetching local TTS voices:', error);
        res.status(502).json({ error: `Could not reach the local TTS server: ${error.message}` });
    }
});

// --- Fish Audio Voices Endpoint ---
app.get('/api/fish-audio/voices', async (req, res) => {
    try {
        const { data: settings, error: settingsError } = await supabase
            .from('user_settings')
            .select('fish_audio_api_key')
            .eq('user_id', req.authUser.id)
            .single();
        if (settingsError) throw settingsError;
        const apiKey = settings?.fish_audio_api_key;
        if (!apiKey) return res.status(400).json({ error: 'Fish Audio API key is required' });
        // Fish Audio API - list popular public models
        // changed from self=true to sort_by=task_count to ensure users see available voices
        const response = await fetch('https://api.fish.audio/model?page_size=100&sort_by=task_count', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            throw new Error(`Fish Audio API error: ${response.statusText}`);
        }

        const data = await response.json();

        // Return the items directly - they contain _id (model ID), title (name), cover_image, etc.
        res.json({ items: data.items || [] });
    } catch (error) {
        console.error('Error fetching Fish Audio voices:', error);
        res.status(500).json({ error: 'Failed to fetch Fish Audio voices' });
    }
});
app.post('/api/upload-profile-image', async (req, res) => {
    const { userId, imageData, fileName } = req.body;

    if (!userId || !imageData || !fileName) {
        return res.status(400).json({ error: 'userId, imageData, and fileName are required' });
    }

    if (supabase) {
        try {
            // Convert base64 to buffer
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            // Generate unique filename
            const ext = path.extname(fileName).toLowerCase();
            const contentTypes = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.webp': 'image/webp'
            };
            const contentType = contentTypes[ext];
            if (!contentType) return res.status(400).json({ error: 'Unsupported image format' });
            const uniqueName = `${userId}/${Date.now()}${ext}`;

            // Upload to Supabase storage
            const { data, error } = await supabase.storage
                .from('profile-images')
                .upload(uniqueName, buffer, {
                    contentType,
                    upsert: true,
                    cacheControl: 'public, max-age=86400'
                });

            if (error) throw error;

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('profile-images')
                .getPublicUrl(uniqueName);

            res.json({ success: true, imageUrl: urlData.publicUrl });
        } catch (error) {
            console.error('Error uploading image:', error);
            res.status(500).json({ error: 'Failed to upload image' });
        }
    } else {
        // Fallback: save locally
        try {
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const ext = path.extname(fileName);
            const uniqueName = `${userId}-${Date.now()}${ext}`;
            const localPath = path.join(__dirname, 'public', 'profile-images', uniqueName);

            // Ensure directory exists
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(localPath, buffer);
            res.json({ success: true, imageUrl: `/profile-images/${uniqueName}` });
        } catch (error) {
            console.error('Error saving image locally:', error);
            res.status(500).json({ error: 'Failed to save image' });
        }
    }
});

// --- Music File Upload ---
app.post('/api/upload-music', async (req, res) => {
    const { userId, audioData, fileName } = req.body;

    if (!userId || !audioData || !fileName) {
        return res.status(400).json({ error: 'userId, audioData, and fileName are required' });
    }

    // Helper to save locally
    const saveLocally = () => {
        try {
            const base64Data = audioData.replace(/^data:audio\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const ext = path.extname(fileName);
            const uniqueName = `${userId}-${Date.now()}${ext}`;
            const localPath = path.join(__dirname, 'public', 'background-music', uniqueName);

            // Ensure directory exists
            const dir = path.dirname(localPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(localPath, buffer);
            const protocol = req.protocol;
            const host = req.get('host');
            const publicUrl = `${protocol}://${host}/background-music/${uniqueName}`;

            console.log('[Upload] Saved locally:', publicUrl);
            return { success: true, url: publicUrl, source: 'local' };
        } catch (localError) {
            console.error('Error saving locally:', localError);
            throw localError;
        }
    };

    if (supabase) {
        try {
            // Convert base64 to buffer
            const base64Data = audioData.replace(/^data:audio\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');

            // Generate unique filename
            const ext = path.extname(fileName);
            const uniqueName = `${userId}-${Date.now()}${ext}`;

            // Upload to Supabase storage (or S3 bucket)
            const { data, error } = await supabase.storage
                .from('background-music')
                .upload(uniqueName, buffer, {
                    contentType: ext === '.mp3' ? 'audio/mpeg' : 'audio/wav',
                    upsert: true,
                    cacheControl: 'public, max-age=86400'
                });

            if (error) {
                console.warn('[Supabase] Upload failed, falling back to local storage:', error.message);
                const result = saveLocally();
                return res.json(result);
            }

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('background-music')
                .getPublicUrl(uniqueName);

            res.json({ success: true, url: urlData.publicUrl, source: 'supabase' });
        } catch (error) {
            console.error('Error uploading music to Supabase:', error);
            // Fallback to local
            try {
                const result = saveLocally();
                res.json(result);
            } catch (fallbackError) {
                res.status(500).json({ error: 'Failed to upload music (both Supabase and local failed)' });
            }
        }
    } else {
        // Fallback: save locally
        try {
            const result = saveLocally();
            res.json(result);
        } catch (error) {
            console.error('Error saving locally:', error);
            res.status(500).json({ error: 'Failed to save music locally' });
        }
    }
});

// --- Audio Presets Endpoints ---
app.get('/api/presets', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json([]);

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('presets')
                .select('*')
                .eq('user_id', userId);

            if (error) throw error;

            // Map back to camelCase for frontend
            const mapped = (data || []).map(p => ({
                id: p.id,
                userId: p.user_id,
                type: p.type,
                name: p.name,
                voiceId: p.voice_id,
                voiceName: p.voice_name,
                voiceGender: p.voice_gender,
                thresholdDb: p.threshold_db,
                minDuration: p.min_duration,
                targetDuration: p.target_duration,
                targetDurationMin: p.target_duration_min,
                targetDurationMax: p.target_duration_max,
                leftPadding: p.left_padding,
                rightPadding: p.right_padding,
                addBackgroundMusic: p.add_background_music,
                musicVolumeDb: p.music_volume_db,
                customMusicUrl: p.custom_music_url,
                hook: p.hook,
                script: p.script,
                captionStyle: p.caption_style,
                hookStyle: p.hook_style,
                ttsProvider: p.tts_provider,
                fishAudioModelId: p.fish_audio_model_id,
                fishAudioModelName: p.fish_audio_model_name,
                vibiVoiceId: p.vibi_voice_id,
                vibiVoiceName: p.vibi_voice_name,
                vibiModelId: p.vibi_model_id,
                localVoiceId: p.local_voice_id,
                localVoiceName: p.local_voice_name,
                localEngine: p.local_engine,
                visual_filter: p.visual_filter
            }));
            return res.json(mapped);
        } catch (error) {
            console.error('[Supabase] Error fetching presets:', error);
            res.status(500).json({ error: 'Failed to fetch presets from Supabase' });
        }
    } else {
        res.status(500).json({ error: 'Supabase not configured' });
    }
});

app.post('/api/presets', async (req, res) => {
    const preset = req.body;
    const { userId } = preset;
    if (!preset.id || !userId) {
        return res.status(400).json({ error: 'Preset ID and userId are required' });
    }

    if (preset.type === 'audio') {
        try {
            selectTargetDuration(preset, () => 0);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    }

    if (supabase) {
        try {
            const dbPreset = {
                id: preset.id,
                user_id: userId,
                type: preset.type,
                name: preset.name,
                voice_id: preset.voiceId,
                voice_name: preset.voiceName,
                voice_gender: preset.voiceGender,
                threshold_db: preset.thresholdDb,
                min_duration: preset.minDuration,
                target_duration: preset.targetDurationMin && preset.targetDurationMax ? null : preset.targetDuration,
                target_duration_min: preset.targetDurationMin,
                target_duration_max: preset.targetDurationMax,
                left_padding: preset.leftPadding,
                right_padding: preset.rightPadding,
                add_background_music: preset.addBackgroundMusic,
                music_volume_db: preset.musicVolumeDb,
                custom_music_url: preset.customMusicUrl,
                hook: preset.hook,
                script: preset.script,
                caption_style: preset.captionStyle,
                hook_style: preset.hookStyle,
                tts_provider: preset.ttsProvider,
                fish_audio_model_id: preset.fishAudioModelId,
                fish_audio_model_name: preset.fishAudioModelName,
                vibi_voice_id: preset.vibiVoiceId,
                vibi_voice_name: preset.vibiVoiceName,
                vibi_model_id: preset.vibiModelId,
                local_voice_id: preset.localVoiceId,
                local_voice_name: preset.localVoiceName,
                local_engine: preset.localEngine,
                visual_filter: preset.visual_filter,
                updated_at: new Date().toISOString()
            };

            let { error } = await supabase
                .from('presets')
                .upsert(dbPreset);

            if (isMissingColumnError(error)) {
                // Migration not applied yet — save everything except the new columns.
                console.warn('[Supabase] vibi_*/local_* preset columns missing, saving without them. Run the 20260910120000 and 20261025120000 migrations to enable them.');
                const { vibi_voice_id, vibi_voice_name, vibi_model_id, local_voice_id, local_voice_name, local_engine, ...legacyPreset } = dbPreset;
                ({ error } = await supabase.from('presets').upsert(legacyPreset));
            }

            if (error) throw error;
            return res.json({ success: true, source: 'supabase' });
        } catch (error) {
            console.error('[Supabase] Error saving preset:', error);
            res.status(500).json({ error: 'Failed to save preset to Supabase' });
        }
    } else {
        res.status(500).json({ error: 'Supabase not configured' });
    }
});

app.delete('/api/presets/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`[Presets] Attempting to delete preset: ${id}`);

    if (supabase) {
        try {
            // First, clear any references to this preset in channel_profiles
            // This handles foreign key constraints for voice presets
            await supabase
                .from('channel_profiles')
                .update({ male_voice_preset_id: null })
                .eq('user_id', req.authUser.id)
                .eq('male_voice_preset_id', id);

            await supabase
                .from('channel_profiles')
                .update({ female_voice_preset_id: null })
                .eq('user_id', req.authUser.id)
                .eq('female_voice_preset_id', id);

            await supabase
                .from('channel_profiles')
                .update({ caption_preset_id: null })
                .eq('user_id', req.authUser.id)
                .eq('caption_preset_id', id);

            await supabase
                .from('channel_profiles')
                .update({ hook_style_preset_id: null })
                .eq('user_id', req.authUser.id)
                .eq('hook_style_preset_id', id);

            await supabase
                .from('channel_profiles')
                .update({ visual_filter_preset_id: null })
                .eq('user_id', req.authUser.id)
                .eq('visual_filter_preset_id', id);

            // Now delete the preset
            const { data, error } = await supabase
                .from('presets')
                .delete()
                .eq('id', id)
                .eq('user_id', req.authUser.id)
                .select();

            if (error) {
                console.error('[Supabase] Delete error details:', error.message, error.details, error.hint);
                throw error;
            }

            console.log(`[Presets] Delete result:`, data);
            return res.json({ success: true, deleted: data?.length || 0 });
        } catch (error) {
            console.error('[Supabase] Error deleting preset:', error);
            res.status(500).json({ error: error.message || 'Failed to delete preset' });
        }
    } else {
        res.status(500).json({ error: 'Supabase not configured' });
    }
});


// --- Channel Profiles Endpoints ---
app.post('/api/save-channel-profiles', async (req, res) => {
    const { userId, profiles } = req.body;
    if (!userId || !profiles) {
        return res.status(400).json({ error: 'User ID and profiles are required' });
    }

    if (supabase) {
        try {
            // Map to Supabase schema
            // Map to Supabase schema
            const captionPresetIds = [...new Set(profiles.map(p => p.caption_preset_id).filter(Boolean))];
            let captionPresetMap = new Map();
            if (captionPresetIds.length > 0) {
                const { data: captionPresets, error: captionPresetsError } = await supabase
                    .from('presets')
                    .select('id, caption_style')
                    .eq('user_id', userId)
                    .eq('type', 'caption_style')
                    .in('id', captionPresetIds);
                if (captionPresetsError) throw captionPresetsError;
                captionPresetMap = new Map((captionPresets || []).map(preset => [preset.id, preset.caption_style || {}]));
            }

            const dbProfiles = profiles.map(p => {
                let id = p.id;
                // Generate UUID if id is missing or temporary
                if (!id || id.includes('profile-')) {
                    id = crypto.randomUUID();
                }
                const captionStyle = captionPresetMap.get(p.caption_preset_id) || {};

                return {
                    id: id,
                    user_id: userId,
                    name: p.name,
                    nickname: p.nickname,
                    image_url: p.image_url,
                    font: captionStyle.font || p.font,
                    style: captionStyle.style || p.style,
                    background_video_type: p.background_video_type,
                    hook_animation_type: p.hook_animation_type,
                    subtitle_size: captionStyle.subtitle_size || p.subtitle_size,
                    stroke_size: captionStyle.stroke_size ?? p.stroke_size,
                    voice_id: p.voice_id,
                    caption_preset_id: p.caption_preset_id,
                    male_voice_preset_id: p.male_voice_preset_id,
                    female_voice_preset_id: p.female_voice_preset_id,
                    hook_style_preset_id: p.hook_style_preset_id,
                    visual_filter_preset_id: p.visual_filter_preset_id,
                    updated_at: new Date().toISOString()
                };
            });

            // Debug log caption_preset_id values
            dbProfiles.forEach(p => {
                console.log(`[DEBUG] Profile "${p.name}" caption_preset_id:`, p.caption_preset_id, 'type:', typeof p.caption_preset_id);
            });
            console.log(`[Supabase] Saving ${dbProfiles.length} profiles. Sample ID: ${dbProfiles[0]?.id}`);

            // 1. Get existing profile IDs for this user
            const { data: existingProfiles, error: fetchError } = await supabase
                .from('channel_profiles')
                .select('id')
                .eq('user_id', userId);

            if (fetchError) throw fetchError;

            const existingIds = existingProfiles.map(p => p.id);
            const incomingIds = dbProfiles.map(p => p.id);

            // 2. Identify profiles to delete
            const idsToDelete = existingIds.filter(id => !incomingIds.includes(id));

            if (idsToDelete.length > 0) {
                console.log(`[Supabase] Deleting ${idsToDelete.length} removed profiles for user ${userId}`);
                const { error: deleteError } = await supabase
                    .from('channel_profiles')
                    .delete()
                    .in('id', idsToDelete);

                if (deleteError) {
                    console.error('[Supabase] Error deleting profiles:', deleteError);
                    // We continue to upsert even if delete fails, but log it
                }
            }

            // 3. Upsert the new/updated profiles
            const { data, error } = await supabase
                .from('channel_profiles')
                .upsert(dbProfiles, { onConflict: 'id' })
                .select();

            if (error) {
                console.error('[Supabase] Upsert error:', error);
                throw error;
            }

            console.log('[Supabase] Upsert success. Returned data:', JSON.stringify(data?.map(d => ({ id: d.id, name: d.name, caption_preset_id: d.caption_preset_id })), null, 2));
            return res.json({ success: true, source: 'supabase', profiles: data || [] });
        } catch (error) {
            console.error('[Supabase] Error saving profiles:', error);
            res.status(500).json({ error: 'Failed to save profiles to Supabase' });
        }
    } else {
        res.status(500).json({ error: 'Supabase not configured' });
    }
});

app.get('/api/channel-profiles/:userId', async (req, res) => {
    const userId = req.authUser.id;

    if (supabase) {
        try {
            const [{ data, error }, { data: captionPresets, error: presetsError }] = await Promise.all([
                supabase.from('channel_profiles').select('*').eq('user_id', userId),
                supabase.from('presets').select('id, name, caption_style').eq('user_id', userId).eq('type', 'caption_style')
            ]);

            if (error) throw error;
            if (presetsError) throw presetsError;

            const captionPresetMap = new Map((captionPresets || []).map(preset => [preset.id, preset]));

            // Map back to what frontend expects
            const profiles = (data || []).map(p => {
                const captionPreset = captionPresetMap.get(p.caption_preset_id);
                const captionStyle = captionPreset?.caption_style || {};
                return {
                    id: p.id,
                    name: p.name,
                    nickname: p.nickname,
                    image_url: p.image_url,
                    font: captionStyle.font || p.font,
                    style: captionStyle.style || p.style,
                    has_background_music: p.has_background_music,
                    background_music_volume: p.background_music_volume,
                    background_video_type: p.background_video_type,
                    hook_animation_type: p.hook_animation_type,
                    subtitle_size: captionStyle.subtitle_size || p.subtitle_size,
                    stroke_size: captionStyle.stroke_size ?? p.stroke_size,
                    caption_animation_type: captionStyle.caption_animation_type || 'scale',
                    caption_color: captionStyle.color || '#FFFFFF',
                    rainbow_text: captionStyle.rainbow_text || false,
                    voice_id: p.voice_id,
                    caption_preset_id: p.caption_preset_id,
                    caption_preset_name: captionPreset?.name || null,
                    male_voice_preset_id: p.male_voice_preset_id,
                    female_voice_preset_id: p.female_voice_preset_id,
                    hook_style_preset_id: p.hook_style_preset_id,
                    visual_filter_preset_id: p.visual_filter_preset_id
                };
            });
            return res.json({ profiles });
        } catch (error) {
            console.error('[Supabase] Error fetching profiles:', error);
        }
    }

    try {
        let profiles = [];
        if (fs.existsSync(profilesFile)) {
            const data = fs.readFileSync(profilesFile, 'utf8');
            const allProfiles = JSON.parse(data);
            profiles = allProfiles[userId] || [];
        }
        res.json({ profiles });
    } catch (error) {
        console.error('Error fetching profiles:', error);
        res.status(500).json({ error: 'Failed to fetch profiles' });
    }
});

// --- Video Generation Endpoint ---

app.post('/api/generate-video', async (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked'
    });

    try {
        let {
            hook, script, userId, channelId, channelName, channelImageUrl,
            channelFont, channelFontUrl, channelVoiceId, channelStyle, elevenlabsApiKey,
            subtitle_size, stroke_size, has_background_music, background_music_volume,
            background_video_type, hook_animation_type, audio_preset_id, caption_preset_id,
            hook_style_preset_id, visual_filter_preset_id, openaiApiKey
        } = req.body;

        console.log(`[Generate] Incoming Request:
            Caption Preset ID: ${caption_preset_id}
            Hook Style Preset ID: ${hook_style_preset_id}
            Channel Font: ${channelFont}
            Channel Subtitle Size: ${subtitle_size}
        `);

        if (!hook || !script) {
            throw new Error('Hook and script text are required');
        }

        // Validate user still exists and is active
        const userValidation = await validateActiveUser(supabase, userId);
        if (!userValidation.valid) {
            res.write(JSON.stringify({ type: 'error', error: userValidation.error || 'User account is no longer active' }) + '\n\n');
            res.end();
            return;
        }

        if (channelId && supabase) {
            const { data: channelProfile, error: channelError } = await supabase
                .from('channel_profiles')
                .select('*')
                .eq('id', channelId)
                .eq('user_id', userId)
                .single();

            if (channelError || !channelProfile) throw new Error('Channel profile not found or access denied');

            channelName = channelProfile.name;
            channelImageUrl = channelProfile.image_url || '';
            channelFont = channelProfile.font;
            channelFontUrl = channelProfile.font_url;
            channelVoiceId = channelProfile.voice_id;
            channelStyle = channelProfile.style;
            subtitle_size = channelProfile.subtitle_size;
            stroke_size = channelProfile.stroke_size;
            has_background_music = channelProfile.has_background_music;
            background_music_volume = channelProfile.background_music_volume;
            background_video_type = channelProfile.background_video_type;
            hook_animation_type = channelProfile.hook_animation_type;
            caption_preset_id = channelProfile.caption_preset_id;
            hook_style_preset_id = channelProfile.hook_style_preset_id;
            visual_filter_preset_id = channelProfile.visual_filter_preset_id;
            audio_preset_id = audio_preset_id || channelProfile.female_voice_preset_id || channelProfile.male_voice_preset_id;
        }

        const localSettings = getLocalSettings(userId);
        let finalElevenlabsApiKey = elevenlabsApiKey || localSettings.elevenlabsApiKey || localSettings.elevenlabs_api_key;
        let finalFishAudioApiKey = localSettings.fishAudioApiKey || localSettings.fish_audio_api_key;
        let finalOpenaiApiKey = openaiApiKey || localSettings.openaiApiKey || localSettings.openai_api_key;
        let finalVibiApiKey = localSettings.vibiApiKey || localSettings.vibi_api_key;
        let finalGroqApiKey = localSettings.groqApiKey || localSettings.groq_api_key;

        // Fetch keys from Supabase as primary source of truth if available
        if (supabase) {
            const { data: userSettingsData, error: settingsError } = await supabase
                .from('user_settings')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (settingsError) throw new Error(`Unable to load user settings: ${settingsError.message}`);
            finalElevenlabsApiKey = userSettingsData?.elevenlabs_api_key || finalElevenlabsApiKey;
            finalFishAudioApiKey = userSettingsData?.fish_audio_api_key || finalFishAudioApiKey;
            finalOpenaiApiKey = userSettingsData?.openai_api_key || finalOpenaiApiKey;
            finalVibiApiKey = userSettingsData?.vibi_api_key || finalVibiApiKey;
            finalGroqApiKey = userSettingsData?.groq_api_key || finalGroqApiKey;
        }

        const finalOpenrouterApiKey = localSettings.openrouterApiKey;

        // Fetch caption preset if provided
        let captionPreset = null;
        if (caption_preset_id) {
            try {
                if (supabase) {
                    console.log(`[Supabase] Attempting to fetch preset ${caption_preset_id} for user ${userId}`);
                    const { data, error } = await supabase
                        .from('presets')
                        .select('*')
                        .eq('id', caption_preset_id)
                        .eq('user_id', userId)
                        .eq('type', 'caption_style')
                        .single();

                    if (!error && data) {
                        // Support both top-level and JSON nested structures
                        const style = data.caption_style || data;
                        captionPreset = {
                            font: style.font || style.caption_style?.font,
                            style: style.style || style.caption_style?.style,
                            subtitle_size: style.subtitle_size || style.caption_style?.subtitle_size,
                            stroke_size: style.stroke_size || style.caption_style?.stroke_size,
                            color: style.color || style.caption_style?.color,
                            rainbow_text: style.rainbow_text || style.caption_style?.rainbow_text || false,
                            caption_animation_type: style.caption_animation_type || style.caption_style?.caption_animation_type || 'scale',
                            look: captionLookFromStyle(style)
                        };
                        console.log(`[Supabase] SUCCESS: Loaded caption preset "${data.name}". Props:`, JSON.stringify(captionPreset));
                    } else {
                        throw new Error('Supabase lookup failed');
                    }
                } else {
                    throw new Error('Supabase not enabled');
                }
            } catch (err) {
                // Fallback to local
                try {
                    const presetsFile = path.join(dataDir, 'presets.json');
                    if (fs.existsSync(presetsFile)) {
                        const data = fs.readFileSync(presetsFile, 'utf8');
                        const allPresets = JSON.parse(data);
                        const preset = allPresets.find(p => p.id === caption_preset_id && p.type === 'caption_style');
                        if (preset) {
                            const style = preset.captionStyle || preset;
                            captionPreset = {
                                font: style.font,
                                style: style.style,
                                subtitle_size: style.subtitle_size,
                                stroke_size: style.stroke_size,
                                color: style.color,
                                rainbow_text: style.rainbow_text,
                                caption_animation_type: style.caption_animation_type || 'scale',
                                look: captionLookFromStyle(style)
                            };
                            console.log(`[Local] SUCCESS: Loaded caption preset "${preset.name}".`);
                        }
                    }
                } catch (localErr) {
                    console.error('Error fetching local caption preset:', localErr);
                }
            }
        }

        // Fetch hook style preset if provided
        let hookStylePreset = null;
        if (hook_style_preset_id) {
            try {
                if (supabase) {
                    const { data, error } = await supabase
                        .from('presets')
                        .select('hook_style')
                        .eq('id', hook_style_preset_id)
                        .eq('user_id', userId)
                        .eq('type', 'hook_style')
                        .single();

                    if (!error && data) {
                        hookStylePreset = data.hook_style;
                        console.log('[Supabase] Loaded hook style preset:', JSON.stringify(data.hook_style));
                    }
                } else {
                    throw new Error('Supabase not configured');
                }
            } catch (err) {
                // Fallback to local
                const presetsFile = path.join(dataDir, 'presets.json');
                if (fs.existsSync(presetsFile)) {
                    const data = fs.readFileSync(presetsFile, 'utf8');
                    const allPresets = JSON.parse(data);
                    const preset = allPresets.find(p => p.id === hook_style_preset_id && p.type === 'hook_style');
                    if (preset) hookStylePreset = preset.hookStyle;
                }
            }
        }

        let visualFilter = 'none';
        if (visual_filter_preset_id && supabase) {
            const { data: visualPreset, error: visualError } = await supabase
                .from('presets')
                .select('visual_filter')
                .eq('id', visual_filter_preset_id)
                .eq('user_id', userId)
                .eq('type', 'visual_filter')
                .single();
            if (visualError) throw new Error(`Unable to load visual filter preset: ${visualError.message}`);
            visualFilter = visualPreset?.visual_filter || 'none';
        }

        // Apply caption preset settings if available, otherwise use channel profile settings
        const finalFont = captionPreset?.font || channelFont || 'Roboto';
        const finalFontUrl = captionPreset ? null : channelFontUrl; // IMPORTANT: If using preset, DON'T use channel's old font URL
        const finalSubtitleSize = captionPreset?.subtitle_size || subtitle_size || 64;
        const finalStrokeSize = captionPreset?.stroke_size || stroke_size || 8;
        const finalCaptionStyle = captionPreset?.style || channelStyle || 'single';

        console.log(`[Generate] Final Font: ${finalFont}, Subtitle Size: ${finalSubtitleSize}, Stroke: ${finalStrokeSize}`);
        if (hookStylePreset) {
            console.log(`[Generate] Hook Style: Font=${hookStylePreset.font}, Radius=${hookStylePreset.borderRadius}`);
        }

        // Fetch audio preset if provided
        let audioPreset = null;
        if (audio_preset_id) {
            try {
                // Try Supabase first if available
                if (supabase) {
                    const { data, error } = await supabase
                        .from('presets')
                        .select('*')
                        .eq('id', audio_preset_id)
                        .eq('user_id', userId)
                        .eq('type', 'audio')
                        .single();

                    if (!error && data) {
                        // Map snake_case to camelCase to match local structure
                        audioPreset = {
                            id: data.id,
                            variable: data.name, // Just in case, though name isn't strictly used for generation logic
                            voiceId: data.voice_id,
                            thresholdDb: data.threshold_db,
                            minDuration: data.min_duration,
                            targetDuration: data.target_duration,
                            targetDurationMin: data.target_duration_min,
                            targetDurationMax: data.target_duration_max,
                            leftPadding: data.left_padding,
                            rightPadding: data.right_padding,
                            addBackgroundMusic: data.add_background_music,
                            musicVolumeDb: data.music_volume_db,
                            customMusicUrl: data.custom_music_url,
                            type: data.type,
                            ttsProvider: data.tts_provider,
                            fishAudioModelId: data.fish_audio_model_id,
                            fishAudioModelName: data.fish_audio_model_name,
                            vibiVoiceId: data.vibi_voice_id,
                            vibiVoiceName: data.vibi_voice_name,
                            vibiModelId: data.vibi_model_id,
                            localVoiceId: data.local_voice_id,
                            localVoiceName: data.local_voice_name,
                            localEngine: data.local_engine
                        };
                        console.log(`[Supabase] Mapped Audio Preset:`, JSON.stringify(audioPreset, null, 2));
                    }
                }

                // Fallback to local file if not found in Supabase or Supabase unavailable
                if (!audioPreset) {
                    const presetsFile = path.join(dataDir, 'presets.json');
                    if (fs.existsSync(presetsFile)) {
                        const data = fs.readFileSync(presetsFile, 'utf8');
                        const allPresets = JSON.parse(data);
                        audioPreset = allPresets.find(p => p.id === audio_preset_id && p.type === 'audio');
                        if (audioPreset) console.log(`[Local] Loaded preset for video generation: ${audioPreset.name}`);
                    }
                }
            } catch (err) {
                console.error('Error fetching audio preset:', err);
            }
        }

        const selectedTargetDuration = selectTargetDuration(audioPreset);
        if (audioPreset) audioPreset.targetDuration = selectedTargetDuration;
        if (selectedTargetDuration) {
            console.log(`[Duration] Selected target for this generation: ${selectedTargetDuration}s`);
        }

        // Voice ID from preset or profile
        const finalVoiceId = audioPreset?.voiceId || channelVoiceId;

        // Slicr settings from preset or defaults
        const slicrSettings = {
            thresholdDb: audioPreset?.thresholdDb ?? -35.0,
            minDuration: audioPreset?.minDuration ?? 0.05,
            leftPadding: audioPreset?.leftPadding ?? 0.05,
            rightPadding: audioPreset?.rightPadding ?? 0.05,
            addBackgroundMusic: audioPreset?.addBackgroundMusic ?? has_background_music ?? false,
            musicVolumeDb: audioPreset?.musicVolumeDb ?? -18,
            customMusicUrl: audioPreset?.customMusicUrl || null
        };

        // Missing variables restoration
        const customVideoPath = null; // Or extract from body if supported
        const finalAudioSpeed = 1.0; // Default
        const finalPitchUp = 0; // Default
        let scriptColors = null;


        const timestamp = Date.now();

        const outputPath = path.join(videosDir, `${timestamp}-video.mp4`);

        // Generate Audio
        const isLocalTts = audioPreset?.ttsProvider === 'local';
        const localTts = isLocalTts ? await getLocalTtsSettings(userId) : null;
        // The local server returns wav; the downstream silence trim decodes either format.
        const localTtsAudio = async (text, part) => {
            if (!audioPreset.localVoiceId) throw new Error("This audio preset has no local TTS voice selected.");
            console.log(`[LocalTTS] Generating ${part} with voice ${audioPreset.localVoiceId} via ${localTts.baseUrl}`);
            const result = await synthesizeLong(text, {
                ...localTts,
                voice: audioPreset.localVoiceId,
                engine: audioPreset.localEngine || undefined,
                workDir: path.join(audioDir, `${timestamp}-local-${part}`),
                transcribe: false
            });
            return fs.readFileSync(result.audioPath);
        };
        const providerLabel = isLocalTts ? 'local TTS' : audioPreset?.ttsProvider === 'vibi' ? 'Vibi'
            : audioPreset?.ttsProvider === 'fish' ? 'Fish Audio' : 'ElevenLabs';
        const emit = (message) => res.write(JSON.stringify({
            type: 'status_update', status: 'audio_processing', message
        }) + '\n\n');

        emit(`Generating hook audio via ${providerLabel}...`);

        // --- Hook Generation & Processing ---
        // --- Hook Generation & Processing ---
        console.log('Generating Hook audio separately...');
        let hookAudioBuffer;
        if (isLocalTts) {
            hookAudioBuffer = await localTtsAudio(hook, 'hook');
        } else if (audioPreset?.ttsProvider === 'fish') {
            if (!finalFishAudioApiKey) throw new Error("Fish Audio API Key is missing. Please add it in Settings.");
            console.log(`[Fish Audio] Generating hook with model ${audioPreset.fishAudioModelId}`);
            hookAudioBuffer = await generateFishAudio(hook, finalFishAudioApiKey, audioPreset.fishAudioModelId);
        } else if (audioPreset?.ttsProvider === 'vibi') {
            if (!isVibiConfigured(finalVibiApiKey)) throw new Error("Vibi API Key is missing. Please add it in Settings.");
            if (!audioPreset.vibiVoiceId) throw new Error("This audio preset has no Vibi voice selected.");
            console.log(`[Vibi] Generating hook with voice ${audioPreset.vibiVoiceId}`);
            hookAudioBuffer = await generateVibiAudio(hook, finalVibiApiKey, audioPreset.vibiVoiceId, audioPreset.vibiModelId);
        } else {
            hookAudioBuffer = await generateAudio(hook, finalElevenlabsApiKey, finalVoiceId, ELEVENLABS_MODEL_ID);
        }
        const ttsExt = isLocalTts ? 'wav' : 'mp3';
        const hookAudioPath = path.join(audioDir, `${timestamp}-hook.${ttsExt}`);
        fs.writeFileSync(hookAudioPath, hookAudioBuffer);

        // Process Hook audio locally (remove silence) - replaced Slicr
        emit('Cleaning hook audio...');
        console.log('[LocalAudio] Processing Hook audio locally...');
        const processedHookPath = path.join(audioDir, `${timestamp}-hook-processed.mp3`);
        const silenceOpts = {
            startThreshold: audioPreset?.thresholdDb ?? -35,
            stopThreshold: audioPreset?.thresholdDb ?? -35,
            startDuration: audioPreset?.minDuration ?? 0.05,
            stopDuration: audioPreset?.minDuration ?? 0.05,
            detectionMethod: 'rms',
            startPeriods: 0  // Don't remove silence at start - TTS audio doesn't have leading silence
        };
        const hookSilenceRemoved = await removeSilence(hookAudioPath, processedHookPath, audioPreset?.thresholdDb ?? -35, silenceOpts);
        if (!hookSilenceRemoved) {
            console.warn('[LocalAudio] Hook silence removal failed, using original');
            fs.copyFileSync(hookAudioPath, processedHookPath);
        }


        // --- Script Generation & Processing ---
        // --- Script Generation & Processing ---
        emit(`Generating script audio via ${providerLabel}...`);
        console.log('Generating Script audio separately...');
        let scriptAudioBuffer;
        if (isLocalTts) {
            scriptAudioBuffer = await localTtsAudio(script, 'script');
        } else if (audioPreset?.ttsProvider === 'fish') {
            if (!finalFishAudioApiKey) throw new Error("Fish Audio API Key is missing. Please add it in Settings.");
            console.log(`[Fish Audio] Generating script with model ${audioPreset.fishAudioModelId}`);
            scriptAudioBuffer = await generateFishAudio(script, finalFishAudioApiKey, audioPreset.fishAudioModelId);
        } else if (audioPreset?.ttsProvider === 'vibi') {
            if (!isVibiConfigured(finalVibiApiKey)) throw new Error("Vibi API Key is missing. Please add it in Settings.");
            if (!audioPreset.vibiVoiceId) throw new Error("This audio preset has no Vibi voice selected.");
            console.log(`[Vibi] Generating script with voice ${audioPreset.vibiVoiceId}`);
            scriptAudioBuffer = await generateVibiAudio(script, finalVibiApiKey, audioPreset.vibiVoiceId, audioPreset.vibiModelId);
        } else {
            // Use batched generation to prevent ElevenLabs volume dropoff on long text
            scriptAudioBuffer = await generateAudioInBatches(script, finalElevenlabsApiKey, finalVoiceId, ELEVENLABS_MODEL_ID, audioDir, timestamp);
        }
        const scriptAudioPath = path.join(audioDir, `${timestamp}-script.${ttsExt}`);
        fs.writeFileSync(scriptAudioPath, scriptAudioBuffer);

        // Process Script audio locally (remove silence) - replaced Slicr
        emit('Cleaning script audio...');
        console.log('[LocalAudio] Processing Script audio locally...');
        const processedScriptPath = path.join(audioDir, `${timestamp}-script-processed.mp3`);
        const scriptSilenceRemoved = await removeSilence(scriptAudioPath, processedScriptPath, audioPreset?.thresholdDb ?? -35, silenceOpts);
        if (!scriptSilenceRemoved) {
            console.warn('[LocalAudio] Script silence removal failed, using original');
            fs.copyFileSync(scriptAudioPath, processedScriptPath);
        }

        // --- Local Transcription (Script Only) ---

        // =================================================================================
        // GLOBAL DURATION CHECK & CAP
        // =================================================================================
        // Ensure total audio duration (Hook + Script) does not exceed preset target duration
        if (audioPreset && audioPreset.targetDuration) {
            console.log(`[Duration Check] Enforcing target duration: ${audioPreset.targetDuration}s`);

            // 1. Get current durations
            const hookDuration = await getAudioDuration(processedHookPath);
            const scriptDuration = await getAudioDuration(processedScriptPath);
            const totalDuration = hookDuration + scriptDuration;

            console.log(`[Duration Check] Current Total: ${totalDuration.toFixed(2)}s (Hook: ${hookDuration.toFixed(2)}s + Script: ${scriptDuration.toFixed(2)}s)`);

            // 2. Speed up only when audio exceeds the selected maximum
            const speedFactor = getSpeedFactorForMaximum(totalDuration, audioPreset.targetDuration);
            if (speedFactor > 1) {
                console.log(`[Duration Check] Audio exceeds the selected maximum; speeding up by factor: ${speedFactor.toFixed(2)}x`);

                // 3. Apply time stretch to Hook
                const stretchedHookPath = path.join(audioDir, `${timestamp}-hook-stretched.mp3`);
                await applyTimeStretch(processedHookPath, stretchedHookPath, speedFactor);
                // Overwrite the variable to point to the new file
                // Note: We don't overwrite the original 'processedHookPath' file on disk to allow debugging if needed, but we update the variable used downstream
                // Actually, to keep it simple for downstream consumers, let's just use the new path variables or rename.
                // However, renderHookVideo uses 'processedHookPath'. Let's overwrite the content of 'processedHookPath' with the stretched version?
                // Better: Update the *variable* effectively. But 'const' prevents reassignment.
                // WE MUST CHANGE 'const processedHookPath' to 'let' earlier, OR just copy the stretched content back to the original path.
                // Copying back is safer for preserving variable references.
                fs.copyFileSync(stretchedHookPath, processedHookPath);

                // 4. Apply time stretch to Script
                const stretchedScriptPath = path.join(audioDir, `${timestamp}-script-stretched.mp3`);
                await applyTimeStretch(processedScriptPath, stretchedScriptPath, speedFactor);
                fs.copyFileSync(stretchedScriptPath, processedScriptPath);

                console.log('[Duration Check] Speed adjustment applied successfully.');

                // Cleanup temp stretched files
                await cleanupFiles([stretchedHookPath, stretchedScriptPath]);
            } else {
                console.log('[Duration Check] Audio is below the selected maximum; keeping 1x speed.');
            }
        }
        // =================================================================================

        // Local voices get word timings from the local server's Whisper first (free, on this machine).
        const transcribeForCaptions = async (audioPath) => {
            if (isLocalTts) {
                try {
                    const { words } = await transcribeWithLocal(audioPath, localTts);
                    console.log(`[LocalTTS] Local Whisper returned ${words.length} words`);
                    return words.map(w => ({
                        text: w.text,
                        startFrame: Math.round(w.start * 30),
                        endFrame: Math.round(w.end * 30),
                        color: 'white'
                    }));
                } catch (e) {
                    console.warn(`[LocalTTS] Local Whisper failed, falling back: ${e.message}`);
                }
            }
            return transcribeAudio(
                audioPath,
                finalElevenlabsApiKey,
                finalOpenaiApiKey,
                channelStyle,
                finalOpenrouterApiKey,
                finalGroqApiKey
            );
        };

        emit(isLocalTts ? 'Transcribing captions via local Whisper...'
            : finalGroqApiKey ? 'Transcribing captions via Groq...' : 'Transcribing captions...');
        console.log('Transcribing processed script audio locally...');
        const wordTimings = await transcribeForCaptions(processedScriptPath);

        // --- Hook Transcription (Floating Mode) ---
        let hookWordTimings = [];
        const isFloatingHook = hook_animation_type === 'float' || hookStylePreset?.animation === 'float' || hookStylePreset?.hookTopPosition;

        if (isFloatingHook) {
            console.log('[Hook Transcription] Floating Hook enabled - Transcribing hook audio...');
            try {
                hookWordTimings = await transcribeForCaptions(processedHookPath);
                console.log(`[Hook Transcription] Got ${hookWordTimings.length} words for hook`);
            } catch (e) {
                console.error('[Hook Transcription] Failed:', e);
                // Fallback: estimate timings if transcription fails
                const words = hook.split(' ');
                const duration = await getAudioDuration(processedHookPath);
                const fps = 30;
                const framesPerWord = Math.floor((duration * fps) / words.length);
                hookWordTimings = words.map((word, i) => ({
                    text: word,
                    startFrame: i * framesPerWord,
                    endFrame: (i + 1) * framesPerWord,
                    color: 'white'
                }));
            }
        }

        // --- Apply Rainbow Colors if enabled ---
        // Vibrant HSL colors for better visibility
        const RAINBOW_COLORS = [
            '#FF5F5F', // Bright Red
            '#FFC043', // Bright Orange/Yellow
            '#33D17A', // Bright Green
            '#3584E4', // Bright Blue
            '#9141AC', // Bright Purple
            '#F66151', // Salmon
            '#8FF0A4', // Pale Green
            '#99C1F1'  // Pale Blue
        ];

        const mainColor = captionPreset?.color || '#FFFFFF';
        const isRainbowEnabled = captionPreset?.rainbow_text || false;

        const applyColors = (timings, context) => {
            if (isRainbowEnabled && timings && timings.length > 0) {
                console.log(`[Rainbow] Applying rainbow colors to ${context} captions...`);
                let lastColorIndex = -1;

                timings.forEach((word) => {
                    // Always color every word with rainbow - rotate through colors
                    let colorIndex;
                    do {
                        colorIndex = Math.floor(Math.random() * RAINBOW_COLORS.length);
                    } while (colorIndex === lastColorIndex); // Avoid same color twice

                    word.color = RAINBOW_COLORS[colorIndex];
                    lastColorIndex = colorIndex;
                });
                console.log(`[Rainbow] Applied colors to ${timings.length} words in ${context}`);
            } else if (timings && timings.length > 0) {
                // Apply the main caption color to all words when rainbow is disabled
                console.log(`[Color] Applying main color ${mainColor} to all ${timings.length} words in ${context}`);
                timings.forEach((word) => {
                    word.color = mainColor;
                });
            }
        };

        // Apply colors to both script and hook timings
        applyColors(wordTimings, 'Script');
        if (isFloatingHook) {
            applyColors(hookWordTimings, 'Hook');
        }

        // Sanitize word timings to fill gaps between words (prevents flickering)
        const sanitizedWordTimings = sanitizeWordTimings(wordTimings, 30);
        const sanitizedHookWordTimings = isFloatingHook ? sanitizeWordTimings(hookWordTimings, 30) : [];

        // Determine final caption animation type
        // Priority: 1. Preset setting, 2. Request body (profile setting), 3. Default 'scale'
        const finalCaptionAnimationType = captionPreset?.caption_animation_type || req.body.caption_animation_type || 'scale';
        console.log(`[Animation] Using caption animation: ${finalCaptionAnimationType}`);

        // --- Prepare Data for Renderer ---

        console.log('[Audio] Custom Music URL:', slicrSettings.customMusicUrl);
        console.log('[Audio] Music Volume (Linear):', Math.pow(10, slicrSettings.musicVolumeDb / 20));

        const result = await renderHookVideo(
            processedHookPath,
            processedScriptPath,
            channelName, channelImageUrl,
            hook, script, outputPath, finalOpenaiApiKey, finalElevenlabsApiKey,
            finalCaptionStyle, finalFont, finalFontUrl, slicrSettings.addBackgroundMusic, Math.pow(10, slicrSettings.musicVolumeDb / 20), slicrSettings.customMusicUrl, finalSubtitleSize, finalStrokeSize,
            res, [], background_video_type, userId, timestamp, finalOpenrouterApiKey, hook_animation_type,
            customVideoPath,
            sanitizedWordTimings,
            scriptColors,
            false, // isSingleAudioBlock = false (Dual audio mode)
            0,      // hookSplitTime = 0 (Ignored)
            hookStylePreset,
            sanitizedHookWordTimings, // New arg: Hook captions
            finalCaptionAnimationType, // captionAnimationType
            visualFilter,
            captionPreset?.look || null
        );

        const videoId = crypto.randomUUID();

        const actualVideoUrl = result?.videoUrl || `/videos/${path.basename(outputPath)}`;
        const thumbFilename = `${videoId}-thumbnail.jpg`;
        const localThumbPath = path.join(thumbnailsDir, thumbFilename);

        let thumbnailUrl = '';

        // 1. Generate local thumbnail (using ffmpeg)
        try {
            await generateThumbnail(outputPath, videoId);

            // 2. Upload to S3 (Production Ready)
            if (fs.existsSync(localThumbPath)) {
                thumbnailUrl = await uploadToS3(localThumbPath, `thumbnails/${thumbFilename}`);
                console.log(`[S3] Uploaded thumbnail: ${thumbnailUrl}`);
                // Cleanup local file to keep server stateless
                fs.unlinkSync(localThumbPath);
            }
        } catch (e) {
            console.error('Thumbnail generation/upload failed:', e);
            // Fallback: If S3 upload failed but file exists, serve locally (though it might be ephemeral)
            if (fs.existsSync(localThumbPath)) {
                thumbnailUrl = `/images/thumbnails/${thumbFilename}`;
            }
        }

        // Get actual video duration from the rendered file
        let videoDuration = 0;
        try {
            const { stdout: durationStdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`);
            videoDuration = parseFloat(durationStdout) || 0;
        } catch (e) {
            console.error('Failed to get video duration:', e.message);
        }

        await saveVideoToSupabase({
            id: videoId,
            user_id: userId,
            title: hook,
            thumbnail_url: thumbnailUrl,
            video_url: actualVideoUrl,
            channel_name: channelName,
            created_at: new Date().toISOString(),
            duration: Math.round(videoDuration),
            views: 0,
            hook_text: hook,
            script_text: script
        });

        res.write(JSON.stringify({
            type: 'status_update',
            status: 'video_complete',
            hookAudio: result.hookAudio,
            scriptAudio: result.scriptAudio,
            hookVideo: result.hookVideo,
            targetDuration: selectedTargetDuration
        }) + '\n\n');
        res.end();

    } catch (error) {
        console.error(error);
        res.write(JSON.stringify({ type: 'status_update', status: 'error', message: error.message }) + '\n\n');
        res.end();
    }
});

// --- Audio Import Video Generation Endpoint ---
// Allows uploading pre-recorded audio instead of using ElevenLabs TTS
app.post('/api/generate-video-from-audio', async (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked'
    });

    try {
        let {
            audioData, audioFileName, hookText, userId, channelId, channelName, channelImageUrl,
            channelFont, channelStyle, subtitle_size, stroke_size,
            background_video_type, hook_animation_type, audio_preset_id, caption_preset_id,
            hook_style_preset_id, visual_filter_preset_id
        } = req.body;

        console.log(`[AudioImport] Incoming Request:
            Hook Text: ${hookText?.substring(0, 50)}...
            Audio File: ${audioFileName}
            Caption Preset ID: ${caption_preset_id}
            Hook Style Preset ID: ${hook_style_preset_id}
        `);

        if (!audioData || !hookText) {
            throw new Error('Audio data and hook text are required');
        }

        // Validate user still exists and is active
        const userValidation = await validateActiveUser(supabase, userId);
        if (!userValidation.valid) {
            res.write(JSON.stringify({ type: 'error', error: userValidation.error || 'User account is no longer active' }) + '\n\n');
            res.end();
            return;
        }

        if (channelId && supabase) {
            const { data: channelProfile, error: channelError } = await supabase
                .from('channel_profiles')
                .select('*')
                .eq('id', channelId)
                .eq('user_id', userId)
                .single();

            if (channelError || !channelProfile) throw new Error('Channel profile not found or access denied');

            channelName = channelProfile.name;
            channelImageUrl = channelProfile.image_url || '';
            channelFont = channelProfile.font;
            channelStyle = channelProfile.style;
            subtitle_size = channelProfile.subtitle_size;
            stroke_size = channelProfile.stroke_size;
            background_video_type = channelProfile.background_video_type;
            hook_animation_type = channelProfile.hook_animation_type;
            caption_preset_id = channelProfile.caption_preset_id;
            hook_style_preset_id = channelProfile.hook_style_preset_id;
            visual_filter_preset_id = channelProfile.visual_filter_preset_id;
            audio_preset_id = audio_preset_id || channelProfile.female_voice_preset_id || channelProfile.male_voice_preset_id;
        }

        res.write(JSON.stringify({ type: 'status_update', status: 'audio_processing' }) + '\n\n');

        // Fetch caption preset
        let captionPreset = null;
        if (caption_preset_id) {
            try {
                if (supabase) {
                    const { data } = await supabase.from('presets').select('*').eq('id', caption_preset_id).eq('user_id', userId).eq('type', 'caption_style').single();
                    if (data) {
                        const style = data.caption_style || data;
                        captionPreset = {
                            font: style.font || style.caption_style?.font,
                            style: style.style || style.caption_style?.style,
                            subtitle_size: style.subtitle_size || style.caption_style?.subtitle_size,
                            stroke_size: style.stroke_size || style.caption_style?.stroke_size,
                            rainbow_text: style.rainbow_text || style.caption_style?.rainbow_text || false,
                            color: style.color || style.caption_style?.color,
                            caption_animation_type: style.caption_animation_type || style.caption_style?.caption_animation_type || 'scale',
                            look: captionLookFromStyle(style)
                        };
                    }
                } else {
                    // Fallback to local
                    const presetsFile = path.join(dataDir, 'presets.json');
                    if (fs.existsSync(presetsFile)) {
                        const data = fs.readFileSync(presetsFile, 'utf8');
                        const allPresets = JSON.parse(data);
                        const preset = allPresets.find(p => p.id === caption_preset_id && p.type === 'caption_style');
                        if (preset) {
                            const style = preset.captionStyle || preset;
                            captionPreset = {
                                font: style.font,
                                style: style.style,
                                subtitle_size: style.subtitle_size,
                                stroke_size: style.stroke_size,
                                rainbow_text: style.rainbow_text,
                                color: style.color,
                                caption_animation_type: style.caption_animation_type || 'scale',
                                look: captionLookFromStyle(style)
                            };
                        }
                    }
                }
            } catch (e) {
                console.error('Error fetching caption preset:', e);
            }
        }

        // Fetch hook style preset
        let hookStylePreset = null;
        if (hook_style_preset_id) {
            try {
                if (supabase) {
                    const { data } = await supabase.from('presets').select('hook_style').eq('id', hook_style_preset_id).eq('user_id', userId).eq('type', 'hook_style').single();
                    if (data) hookStylePreset = data.hook_style;
                } else {
                    const presetsFile = path.join(dataDir, 'presets.json');
                    if (fs.existsSync(presetsFile)) {
                        const data = fs.readFileSync(presetsFile, 'utf8');
                        const allPresets = JSON.parse(data);
                        const preset = allPresets.find(p => p.id === hook_style_preset_id && p.type === 'hook_style');
                        if (preset) hookStylePreset = preset.hookStyle;
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // Fetch audio preset for Slicr and music settings
        let audioPreset = null;
        if (audio_preset_id) {
            try {
                if (supabase) {
                    const { data } = await supabase.from('presets').select('*').eq('id', audio_preset_id).eq('user_id', userId).eq('type', 'audio').single();
                    if (data) {
                        audioPreset = {
                            thresholdDb: data.threshold_db ?? -35,
                            minDuration: data.min_duration ?? 0.05,
                            addBackgroundMusic: data.add_background_music ?? false,
                            musicVolumeDb: data.music_volume_db ?? -18,
                            customMusicUrl: data.custom_music_url || null,
                            targetDuration: data.target_duration || null, // For enforcing max length
                            targetDurationMin: data.target_duration_min,
                            targetDurationMax: data.target_duration_max
                        };
                    }
                } else {
                    const presetsFile = path.join(dataDir, 'presets.json');
                    if (fs.existsSync(presetsFile)) {
                        const data = fs.readFileSync(presetsFile, 'utf8');
                        const allPresets = JSON.parse(data);
                        const preset = allPresets.find(p => p.id === audio_preset_id && p.type === 'audio');
                        if (preset) {
                            audioPreset = {
                                thresholdDb: preset.thresholdDb ?? -35,
                                minDuration: preset.minDuration ?? 0.05,
                                addBackgroundMusic: preset.addBackgroundMusic ?? false,
                                musicVolumeDb: preset.musicVolumeDb ?? -18,
                                customMusicUrl: preset.customMusicUrl || null,
                                targetDuration: preset.targetDuration,
                                targetDurationMin: preset.targetDurationMin,
                                targetDurationMax: preset.targetDurationMax
                            };
                        }
                    }
                }
            } catch (e) { /* ignore */ }
        }

        let visualFilter = 'none';
        if (visual_filter_preset_id && supabase) {
            const { data: visualPreset, error: visualError } = await supabase
                .from('presets')
                .select('visual_filter')
                .eq('id', visual_filter_preset_id)
                .eq('user_id', userId)
                .eq('type', 'visual_filter')
                .single();
            if (visualError) throw new Error(`Unable to load visual filter preset: ${visualError.message}`);
            visualFilter = visualPreset?.visual_filter || 'none';
        }

        const selectedTargetDuration = selectTargetDuration(audioPreset);
        if (audioPreset) audioPreset.targetDuration = selectedTargetDuration;
        if (selectedTargetDuration) {
            console.log(`[AudioImport] Selected target for this generation: ${selectedTargetDuration}s`);
        }

        const finalFont = captionPreset?.font || channelFont || 'Roboto';
        const finalCaptionStyle = captionPreset?.style || channelStyle || 'single';
        const finalSubtitleSize = captionPreset?.subtitle_size || subtitle_size || 64;
        const finalStrokeSize = captionPreset?.stroke_size || stroke_size || 8;

        const timestamp = Date.now();

        // Decode and save uploaded audio
        const base64Data = audioData.replace(/^data:audio\/\w+;base64,/, '');
        const audioBuffer = Buffer.from(base64Data, 'base64');
        const ext = path.extname(audioFileName) || '.mp3';
        const uploadedAudioPath = path.join(audioDir, `${timestamp}-uploaded${ext}`);
        fs.writeFileSync(uploadedAudioPath, audioBuffer);
        console.log('[AudioImport] Saved uploaded audio:', uploadedAudioPath);

        // Process audio locally (remove silence) - replaced Slicr
        console.log('[AudioImport] Processing audio locally...');
        const processedAudioPath = path.join(audioDir, `${timestamp}-processed.mp3`);
        const importSilenceOpts = {
            startThreshold: audioPreset?.thresholdDb ?? -35,
            stopThreshold: audioPreset?.thresholdDb ?? -35,
            startDuration: audioPreset?.minDuration ?? 0.05,
            stopDuration: audioPreset?.minDuration ?? 0.05,
            detectionMethod: 'rms',
            startPeriods: 0  // Don't remove silence at start - preserve beginning of audio
        };
        const silenceRemoved = await removeSilence(uploadedAudioPath, processedAudioPath, audioPreset?.thresholdDb ?? -35, importSilenceOpts);
        if (!silenceRemoved) {
            console.warn('[AudioImport] Silence removal failed, using original');
            fs.copyFileSync(uploadedAudioPath, processedAudioPath);
        }
        console.log('[AudioImport] Processed audio saved:', processedAudioPath);

        // Get audio duration to calculate hook split time
        let totalDuration = await getAudioDuration(processedAudioPath);
        console.log(`[AudioImport] Initial duration: ${totalDuration.toFixed(2)}s`);

        // Enforce target duration if set in audio preset
        const importSpeedFactor = getSpeedFactorForMaximum(totalDuration, audioPreset?.targetDuration);
        if (importSpeedFactor > 1) {
            console.log(`[AudioImport] Audio exceeds ${audioPreset.targetDuration}s; speeding up by factor ${importSpeedFactor.toFixed(2)}x`);

            const stretchedAudioPath = path.join(audioDir, `${timestamp}-stretched.mp3`);
            await applyTimeStretch(processedAudioPath, stretchedAudioPath, importSpeedFactor);

            // Replace processed audio with stretched version
            fs.copyFileSync(stretchedAudioPath, processedAudioPath);
            totalDuration = await getAudioDuration(processedAudioPath);
            console.log(`[AudioImport] New duration after stretch: ${totalDuration.toFixed(2)}s`);
        }

        // First 30% or max 3 seconds is the hook
        let hookSplitTime = Math.min(3.0, totalDuration * 0.3);
        console.log(`[AudioImport] Provisional hook split: ${hookSplitTime.toFixed(2)}s`);

        // Get ElevenLabs API key for transcription
        let elevenlabsApiKey = null;
        let openaiApiKey = null;
        if (supabase) {
            try {
                const { data } = await supabase.from('user_settings').select('elevenlabs_api_key, openai_api_key').eq('user_id', userId).single();
                if (data) {
                    elevenlabsApiKey = data.elevenlabs_api_key;
                    openaiApiKey = data.openai_api_key;
                }
            } catch (e) { /* ignore */ }
        }
        if (!elevenlabsApiKey || !openaiApiKey) {
            const localSettings = getLocalSettings(userId);
            if (!elevenlabsApiKey) elevenlabsApiKey = localSettings.elevenlabs_api_key || localSettings.elevenlabsApiKey;
            if (!openaiApiKey) openaiApiKey = localSettings.openai_api_key || localSettings.openaiApiKey;
        }

        // --- Transcribe and apply Rainbow Colors ---
        res.write(JSON.stringify({ type: 'status_update', status: 'transcribing' }) + '\n\n');
        console.log('[AudioImport] Transcribing audio...');

        let wordTimings = null;
        let hasAccurateWordTimings = false;
        try {
            wordTimings = await transcribeAudio(
                processedAudioPath,
                elevenlabsApiKey,
                openaiApiKey,
                finalCaptionStyle
            );
            hasAccurateWordTimings = true;
        } catch (transcribeError) {
            console.error('[AudioImport] Transcription failed, using fallback:', transcribeError.message);
            // Fallback: estimate word timings based on hookText
            const words = hookText.split(' ').filter(w => w.trim());
            const scriptDuration = totalDuration - hookSplitTime;
            const fps = 30;
            const framesPerWord = Math.floor((scriptDuration * fps) / Math.max(1, words.length));
            wordTimings = words.map((word, i) => ({
                text: word,
                startFrame: i * framesPerWord,
                endFrame: (i + 1) * framesPerWord,
                color: 'white'
            }));
        }

        if (hasAccurateWordTimings) {
            hookSplitTime = deriveHookSplitTime(hookText, wordTimings, totalDuration, 30);
            console.log(`[AudioImport] Timestamp-derived hook split: ${hookSplitTime.toFixed(2)}s`);
        }

        // Apply Rainbow Colors if enabled
        const isRainbowEnabled = captionPreset?.rainbow_text || false;
        const mainColor = captionPreset?.color || '#FFFFFF';

        if (isRainbowEnabled && wordTimings && wordTimings.length > 0) {
            console.log('[AudioImport] Applying rainbow colors to captions...');
            const RAINBOW_COLORS = [
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

            wordTimings.forEach((word) => {
                // Always color every word with rainbow - rotate through colors
                let colorIndex;
                do {
                    colorIndex = Math.floor(Math.random() * RAINBOW_COLORS.length);
                } while (colorIndex === lastColorIndex);

                word.color = RAINBOW_COLORS[colorIndex];
                lastColorIndex = colorIndex;
            });
            console.log(`[AudioImport] Applied rainbow colors to ${wordTimings.length} words`);
        } else if (wordTimings && wordTimings.length > 0) {
            // Apply the main caption color to all words when rainbow is disabled
            console.log(`[AudioImport] Applying main color ${mainColor} to all ${wordTimings.length} words`);
            wordTimings.forEach((word) => {
                word.color = mainColor;
            });
        }

        // Sanitize word timings to fill gaps between words (prevents flickering)
        const sanitizedWordTimings = sanitizeWordTimings(wordTimings, 30);

        // Derive Hook timings from full timings (slice words before hookSplitTime)
        const hookFPS = 30;
        const hookFrameLimit = Math.ceil(hookSplitTime * hookFPS);
        const hookWordTimings = sanitizedWordTimings.filter(w => w.startFrame < hookFrameLimit);
        console.log(`[AudioImport] Sliced ${hookWordTimings.length} words for hook captions (limit: ${hookFrameLimit} frames)`);

        // Background music settings
        const addMusic = audioPreset?.addBackgroundMusic ?? false;
        const musicVolumeLinear = Math.pow(10, (audioPreset?.musicVolumeDb ?? -18) / 20);

        const outputPath = path.join(videosDir, `${timestamp}-video.mp4`);

        res.write(JSON.stringify({ type: 'status_update', status: 'rendering' }) + '\n\n');

        // Use renderHookVideo with precomputed word timings (with rainbow colors applied)
        const result = await renderHookVideo(
            processedAudioPath,  // hookAudioPath  
            processedAudioPath,  // scriptAudioPath (same file, uses hookSplitTime)
            channelName, channelImageUrl,
            hookText, hookText,  // Use hookText for both hook and script display
            outputPath,
            openaiApiKey,
            elevenlabsApiKey,
            finalCaptionStyle, finalFont, null,  // fontUrl
            addMusic, musicVolumeLinear, audioPreset?.customMusicUrl || null,
            finalSubtitleSize, finalStrokeSize,
            res, [],  // filesToCleanup
            background_video_type || 'gameplay',
            userId, timestamp,
            null,  // openrouterApiKey
            hook_animation_type || 'fall',
            null,  // customVideoPath
            sanitizedWordTimings,  // PASS SANITIZED WORD TIMINGS WITH COLORS
            null,  // scriptColors
            true,  // isSingleAudioBlock = TRUE for imported audio
            hookSplitTime,
            hookStylePreset,
            hookWordTimings, // Pass derived hook timings
            captionPreset?.caption_animation_type || req.body.caption_animation_type || 'scale',
            visualFilter,
            captionPreset?.look || null
        );

        // Save video metadata
        const videoId = crypto.randomUUID();
        const actualVideoUrl = result?.videoUrl || `/videos/${path.basename(outputPath)}`;
        const thumbFilename = `${videoId}-thumbnail.jpg`;
        const localThumbPath = path.join(thumbnailsDir, thumbFilename);

        let thumbnailUrl = '';

        // Generate and upload thumbnail (same as main endpoint)
        try {
            await generateThumbnail(outputPath, videoId);

            if (fs.existsSync(localThumbPath)) {
                thumbnailUrl = await uploadToS3(localThumbPath, `thumbnails/${thumbFilename}`);
                console.log(`[AudioImport] Uploaded thumbnail: ${thumbnailUrl}`);
                fs.unlinkSync(localThumbPath);
            }
        } catch (e) {
            console.error('[AudioImport] Thumbnail generation/upload failed:', e.message);
            // Without S3 the thumbnail is served locally
            if (fs.existsSync(localThumbPath)) {
                thumbnailUrl = `/images/thumbnails/${thumbFilename}`;
            }
        }

        await saveVideoToSupabase({
            id: videoId,
            user_id: userId,
            title: hookText,
            thumbnail_url: thumbnailUrl,
            video_url: actualVideoUrl,
            channel_name: channelName,
            created_at: new Date().toISOString(),
            duration: Math.round(totalDuration),
            views: 0,
            hook_text: hookText,
            script_text: '[Imported Audio]'
        });

        res.write(JSON.stringify({
            type: 'status_update',
            status: 'video_complete',
            hookVideo: actualVideoUrl,
            targetDuration: selectedTargetDuration
        }) + '\n\n');
        res.end();

    } catch (error) {
        console.error('[AudioImport] Error:', error);
        res.write(JSON.stringify({ type: 'status_update', status: 'error', message: error.message }) + '\n\n');
        res.end();
    }
});

// Cron Jobs endpoints (Supabase-based)
app.use('/api/cron-jobs', (_req, res) => res.status(410).json({ error: 'Cron automation has been removed' }));
app.use('/api/cron-executions', (_req, res) => res.status(410).json({ error: 'Cron automation has been removed' }));
app.get('/api/cron-jobs', async (req, res) => {
    const { userId } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
    }

    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('cron_jobs')
                .select('*, channel_profiles(id, name, image_url)')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            res.json(data || []);
        } catch (error) {
            console.error('[Cron API] Error fetching jobs:', error);
            res.status(500).json({ error: 'Failed to fetch cron jobs' });
        }
    } else {
        // Fallback to local file
        try {
            const jobs = readJsonFile(cronJobsFile);
            res.json(jobs.filter(j => j.user_id === userId));
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch cron jobs' });
        }
    }
});

app.get('/api/cron-jobs/:id', async (req, res) => {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('cron_jobs')
                .select('*, channel_profiles(*)')
                .eq('id', req.params.id)
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Cron job not found' });

            res.json(data);
        } catch (error) {
            console.error('[Cron API] Error fetching job:', error);
            res.status(500).json({ error: 'Failed to fetch cron job' });
        }
    } else {
        res.status(500).json({ error: 'Supabase not configured' });
    }
});

app.post('/api/cron-jobs', async (req, res) => {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('cron_jobs')
                .insert({
                    ...req.body,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select()
                .single();

            if (error) throw error;

            // Schedule the job if enabled
            if (data.enabled) {
                await cronJobService.scheduleJob(data);
            }

            res.status(201).json(data);
        } catch (error) {
            console.error('[Cron API] Error creating job:', error);
            res.status(500).json({ error: 'Failed to create cron job: ' + error.message });
        }
    } else {
        // Fallback to local file
        try {
            const jobs = readJsonFile(cronJobsFile);
            const newJob = {
                id: Date.now().toString(),
                ...req.body,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };

            jobs.push(newJob);
            writeJsonFile(cronJobsFile, jobs);
            cronJobService.scheduleJob(newJob);

            res.status(201).json(newJob);
        } catch (error) {
            console.error('Error creating cron job:', error);
            res.status(500).json({ error: 'Failed to create cron job' });
        }
    }
});

app.put('/api/cron-jobs/:id', async (req, res) => {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('cron_jobs')
                .update({
                    ...req.body,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Cron job not found' });

            // Refresh scheduling
            await cronJobService.refreshJob(req.params.id);

            res.json(data);
        } catch (error) {
            console.error('[Cron API] Error updating job:', error);
            res.status(500).json({ error: 'Failed to update cron job' });
        }
    } else {
        // Fallback to local file
        try {
            const jobs = readJsonFile(cronJobsFile);
            const index = jobs.findIndex(j => j.id === req.params.id);

            if (index === -1) {
                return res.status(404).json({ error: 'Cron job not found' });
            }

            jobs[index] = {
                ...jobs[index],
                ...req.body,
                updated_at: new Date().toISOString(),
            };

            writeJsonFile(cronJobsFile, jobs);
            cronJobService.unscheduleJob(req.params.id);
            if (jobs[index].enabled) {
                cronJobService.scheduleJob(jobs[index]);
            }

            res.json(jobs[index]);
        } catch (error) {
            console.error('Error updating cron job:', error);
            res.status(500).json({ error: 'Failed to update cron job' });
        }
    }
});

app.delete('/api/cron-jobs/:id', async (req, res) => {
    if (supabase) {
        try {
            const { error } = await supabase
                .from('cron_jobs')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;

            cronJobService.unscheduleJob(req.params.id);
            res.status(204).send();
        } catch (error) {
            console.error('[Cron API] Error deleting job:', error);
            res.status(500).json({ error: 'Failed to delete cron job' });
        }
    } else {
        try {
            const jobs = readJsonFile(cronJobsFile);
            const filtered = jobs.filter(j => j.id !== req.params.id);

            if (filtered.length === jobs.length) {
                return res.status(404).json({ error: 'Cron job not found' });
            }

            writeJsonFile(cronJobsFile, filtered);
            cronJobService.unscheduleJob(req.params.id);

            res.status(204).send();
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete cron job' });
        }
    }
});

// Cron Job Executions endpoints
app.get('/api/cron-jobs/:id/executions', async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }

    try {
        const { data, error } = await supabase
            .from('cron_job_executions')
            .select('*')
            .eq('cron_job_id', req.params.id)
            .order('started_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('[Cron API] Error fetching executions:', error);
        res.status(500).json({ error: 'Failed to fetch executions' });
    }
});

app.get('/api/cron-executions/:id', async (req, res) => {
    if (!supabase) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }

    try {
        const { data, error } = await supabase
            .from('cron_job_executions')
            .select('*, research_results(*)')
            .eq('id', req.params.id)
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Execution not found' });

        res.json(data);
    } catch (error) {
        console.error('[Cron API] Error fetching execution:', error);
        res.status(500).json({ error: 'Failed to fetch execution' });
    }
});

// Manual trigger endpoint
app.post('/api/cron-jobs/:id/run', async (req, res) => {
    try {
        const result = await cronJobService.executeJob(req.params.id, true);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[Cron API] Error running job:', error);
        res.status(500).json({ error: error.message });
    }
});

// Trendy Bot proxy endpoints
app.use('/api/trendy-bot', (_req, res) => res.status(410).json({ error: 'Automated research has been removed' }));
app.post('/api/trendy-bot/research', async (req, res) => {
    try {
        const result = await trendyBotService.submitResearchJob(req.body);
        res.json(result);
    } catch (error) {
        console.error('Trendy Bot research error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/trendy-bot/research/:jobId', async (req, res) => {
    try {
        const result = await trendyBotService.getResearchJobStatus(req.params.jobId);
        res.json(result);
    } catch (error) {
        console.error('Trendy Bot job status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Slicr.me proxy endpoints
app.post('/api/slicr/process', async (req, res) => {
    try {
        const { audioPath, params } = req.body;
        const result = await slicerService.processAudio(audioPath, params);
        res.json(result);
    } catch (error) {
        console.error('Slicr processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, '../dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// Test Telegram Integration
app.post('/api/test-telegram', async (req, res) => {
    try {
        const { telegramUserId } = req.body;
        const botToken = process.env.TELEGRAM_BOT_TOKEN;

        if (!botToken) {
            return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured in server environment' });
        }

        if (!telegramUserId) {
            return res.status(400).json({ error: 'Telegram User ID is required' });
        }

        const message = "🔔 *Test Notification*\n\nIf you are reading this, your Telegram integration is working correctly! 🚀";

        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramUserId,
                text: message,
                parse_mode: 'Markdown'
            })
        });

        const data = await response.json();

        if (data.ok) {
            res.json({ success: true });
        } else {
            console.error('Telegram API Error:', data);
            res.status(500).json({ error: data.description || 'Failed to send Telegram message' });
        }
    } catch (error) {
        console.error('Error sending Telegram test message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve React App in Production
if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, '../dist');
    app.use(express.static(distPath));

    // Handle React routing, return all requests to React app
    app.get('*', (req, res) => {
        // Exclude API/static routes from this fallback just in case
        if (req.path.startsWith('/api') || req.path.startsWith('/videos') || req.path.startsWith('/images')) {
            return res.status(404).json({ error: 'Endpoint not found' });
        }
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// Start server
app.listen(PORT, async () => {
    console.log(`🚀 Get Brainrot server running on port ${PORT}`);
    console.log(`📁 Data directory: ${dataDir}`);
    console.log(`🎥 Videos directory: ${videosDir}`);

});

export { app, supabase };
