import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { ElevenLabsClient } from "elevenlabs";
import { transcribeWithGroq, isGroqConfigured } from "../services/groqTranscribeService.js";

const execAsync = promisify(exec);

// Eleven v4 is the most expressive TTS model (used everywhere unless overridden).
export const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_v4';

/**
 * Splits text into batches at sentence boundaries for better TTS quality.
 * ElevenLabs can lose volume/energy on very long text, so we split and generate separately.
 * @param {string} text - Full text to split
 * @param {number} maxChars - Maximum characters per batch (default 1500)
 * @returns {string[]} - Array of text batches
 */
export function splitTextIntoBatches(text, maxChars = 1500) {
    if (!text || text.length <= maxChars) {
        return [text];
    }

    const batches = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxChars) {
            batches.push(remaining.trim());
            break;
        }

        // Find the last sentence boundary within maxChars
        let splitIndex = -1;
        const searchRange = remaining.substring(0, maxChars);

        // Priority: period, exclamation, question mark - look for last occurrence
        const periodIndex = searchRange.lastIndexOf('. ');
        const exclamationIndex = searchRange.lastIndexOf('! ');
        const questionIndex = searchRange.lastIndexOf('? ');

        // Find the latest sentence boundary
        splitIndex = Math.max(periodIndex, exclamationIndex, questionIndex);

        // If no sentence boundary found, try comma or semicolon
        if (splitIndex === -1) {
            const commaIndex = searchRange.lastIndexOf(', ');
            const semicolonIndex = searchRange.lastIndexOf('; ');
            splitIndex = Math.max(commaIndex, semicolonIndex);
        }

        // If still no good split point, just split at last space
        if (splitIndex === -1) {
            splitIndex = searchRange.lastIndexOf(' ');
        }

        // If no space at all (very long word), force split at maxChars
        if (splitIndex === -1) {
            splitIndex = maxChars - 1;
        }

        // Include the punctuation in the batch
        const batch = remaining.substring(0, splitIndex + 1).trim();
        batches.push(batch);
        remaining = remaining.substring(splitIndex + 1).trim();
    }

    console.log(`[Batching] Split text into ${batches.length} batches: ${batches.map(b => b.length + ' chars').join(', ')}`);
    return batches;
}

/**
 * Generates audio in batches and concatenates the results.
 * Fixes ElevenLabs volume dropoff on long text.
 * @param {string} text - Full text to convert
 * @param {string} apiKey - ElevenLabs API key
 * @param {string} voiceId - ElevenLabs voice ID
 * @param {string} modelId - ElevenLabs model ID
 * @param {string} tempDir - Directory for temporary files
 * @param {string} timestamp - Timestamp for unique filenames
 * @returns {Promise<Buffer>} - Concatenated audio buffer
 */
export async function generateAudioInBatches(text, apiKey, voiceId, modelId, tempDir, timestamp) {
    const batches = splitTextIntoBatches(text, 1500);

    // If only one batch, use regular generation
    if (batches.length === 1) {
        return await generateAudio(text, apiKey, voiceId, modelId);
    }

    console.log(`[BatchAudio] Generating ${batches.length} audio batches for ElevenLabs...`);

    const batchFiles = [];
    try {
        // Generate audio for each batch
        for (let i = 0; i < batches.length; i++) {
            console.log(`[BatchAudio] Generating batch ${i + 1}/${batches.length} (${batches[i].length} chars)...`);
            const batchBuffer = await generateAudio(batches[i], apiKey, voiceId, modelId);
            const batchPath = path.join(tempDir, `${timestamp}-batch-${i}.mp3`);
            fs.writeFileSync(batchPath, batchBuffer);
            batchFiles.push(batchPath);
        }

        // Concatenate all batch files using FFmpeg
        const concatListPath = path.join(tempDir, `${timestamp}-concat.txt`);
        const concatContent = batchFiles.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(concatListPath, concatContent);

        const outputPath = path.join(tempDir, `${timestamp}-batched.mp3`);
        const concatCommand = `ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy -y "${outputPath}"`;
        console.log(`[BatchAudio] Concatenating ${batches.length} batches...`);
        await execAsync(concatCommand);

        // Read the concatenated file
        const resultBuffer = fs.readFileSync(outputPath);
        console.log(`[BatchAudio] Successfully generated batched audio (${resultBuffer.length} bytes)`);

        // Cleanup temp files
        for (const file of batchFiles) {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        if (fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

        return resultBuffer;
    } catch (error) {
        // Cleanup on error
        for (const file of batchFiles) {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        throw error;
    }
}

/**
 * Generates audio using ElevenLabs API
 * @param {string} text - The text to convert to speech
 * @param {string} apiKey - ElevenLabs API key
 * @param {string} voiceId - ElevenLabs voice ID
 * @param {string} modelId - ElevenLabs model ID
 * @returns {Promise<ArrayBuffer>} - ArrayBuffer containing the audio data
 */
export async function generateAudio(text, apiKey, voiceId, modelId) {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 2000; // 2 seconds

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`Generating audio (attempt ${attempt}/${MAX_RETRIES}) for text: "${text.substring(0, 30)}..." with voice ID: ${voiceId}`);
            console.log(`Model ID: ${modelId}`);

            const client = new ElevenLabsClient({ apiKey });

            const audioStream = await client.textToSpeech.convert(voiceId, {
                output_format: "mp3_44100_128",
                text: text,
                model_id: modelId,
                voice_settings: {
                    stability: 0.6,
                    similarity_boost: 0.75
                }
            });

            // Convert stream to buffer
            const chunks = [];
            for await (const chunk of audioStream) {
                chunks.push(Buffer.from(chunk));
            }

            const audioBuffer = Buffer.concat(chunks);
            console.log('Audio generated successfully');
            return audioBuffer;
        } catch (error) {
            console.error(`Error generating audio (attempt ${attempt}/${MAX_RETRIES}):`, error);

            // If it's the last attempt, throw the error
            if (attempt === MAX_RETRIES) {
                throw error;
            }

            // Calculate delay with exponential backoff
            const delay = BASE_DELAY * Math.pow(2, attempt - 1);
            console.log(`Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Generates audio using Fish Audio API
 * @param {string} text - The text to convert to speech
 * @param {string} apiKey - Fish Audio API key
 * @param {string} modelId - Fish Audio model ID (reference_id)
 * @returns {Promise<Buffer>} - Buffer containing the audio data
 */
export async function generateFishAudio(text, apiKey, modelId) {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[FishAudio] Generating audio (attempt ${attempt}/${MAX_RETRIES}) for text: "${text.substring(0, 30)}..." with model: ${modelId}`);

            // Fish Audio uses msgpack for request body
            // We'll use JSON format which is also supported
            const requestBody = {
                text: text,
                reference_id: modelId,
                format: 'mp3'
            };

            const response = await fetch('https://api.fish.audio/v1/tts', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'model': 's1'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Fish Audio API error (${response.status}): ${errorText}`);
            }

            // Get the audio buffer from the response
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuffer);

            console.log(`[FishAudio] Audio generated successfully (${audioBuffer.length} bytes)`);
            return audioBuffer;
        } catch (error) {
            console.error(`[FishAudio] Error generating audio (attempt ${attempt}/${MAX_RETRIES}):`, error);

            if (attempt === MAX_RETRIES) {
                throw error;
            }

            const delay = BASE_DELAY * Math.pow(2, attempt - 1);
            console.log(`[FishAudio] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Gets audio duration using ffmpeg
 * @param {string} filePath - Path to the audio file
 * @returns {Promise<number>} - Duration in seconds
 */
export async function getAudioDuration(filePath) {
    try {
        const { stdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
        const durationInSeconds = parseFloat(stdout);

        if (isNaN(durationInSeconds)) {
            console.error(`[getAudioDuration] Could not parse duration for: ${filePath}`);
            return 0;
        }

        return durationInSeconds;
    } catch (error) {
        console.error('Error getting audio duration:', error);
        return 0;
    }
}

/**
 * Gets audio sample rate using ffmpeg
 * @param {string} filePath - Path to the audio file
 * @returns {Promise<number>} - Sample rate in Hz
 */
export async function getAudioSampleRate(filePath) {
    const { stdout } = await execAsync(`ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
    return parseInt(stdout.trim());
}

/**
 * Cleans up files
 * @param {string[]} files - Array of file paths to clean up
 * @returns {Promise<void>}
 */
export async function cleanupFiles(files) {
    for (const file of files) {
        try {
            if (fs.existsSync(file)) {
                await fs.promises.unlink(file);
                console.log(`Cleaned up file: ${file}`);
            }
        } catch (error) {
            console.error(`Error cleaning up file ${file}:`, error);
        }
    }
}

/**
 * Re-encodes audio file with proper buffer flushing to fix corruption issues.
 * This is critical for audio from external services (like Slicr) that may have
 * incomplete buffer flushing, causing choppy/cut audio at the end.
 * @param {string} inputPath - Input file path
 * @param {string} outputPath - Output file path (can be same as input for in-place)
 * @returns {Promise<void>}
 */
export async function normalizeAudio(inputPath, outputPath) {
    const tempPath = outputPath + '.normalize-temp.mp3';

    try {
        // Get source sample rate to preserve quality
        const sampleRate = await getAudioSampleRate(inputPath);

        // Re-encode with proper settings to ensure complete audio:
        // -fflags +genpts: Generate proper timestamps
        // -acodec libmp3lame: Explicit MP3 encoder
        // -b:a 192k: High quality bitrate
        // -ar: Preserve sample rate
        // -af aresample=async=1: Force buffer flush
        const command = `ffmpeg -fflags +genpts -i "${inputPath}" -af "aresample=async=1" -ar ${sampleRate} -b:a 192k -acodec libmp3lame -q:a 0 -y "${tempPath}"`;
        console.log(`[NormalizeAudio] Re-encoding: ${inputPath}`);

        await execAsync(command);

        // Verify output
        const stats = fs.statSync(tempPath);
        if (stats.size < 1000) {
            throw new Error(`Normalized file is too small (${stats.size} bytes)`);
        }

        // Copy normalized file to output
        fs.copyFileSync(tempPath, outputPath);
        console.log(`[NormalizeAudio] Success: ${stats.size} bytes`);

        // Cleanup temp
        await cleanupFiles([tempPath]);
    } catch (error) {
        console.error('[NormalizeAudio] Error:', error);
        // If normalization fails, keep the original file
        if (inputPath !== outputPath && fs.existsSync(inputPath)) {
            fs.copyFileSync(inputPath, outputPath);
        }
    }
}

/**
 * Removes silence from the entire audio file using FFmpeg's silenceremove filter.
 * @param {string} inputFile - Path to input audio file
 * @param {string} outputFile - Path to output audio file
 * @param {number} silenceThresholdDb - Silence threshold in dB (default: -30.0)
 * @param {Object} options - Additional options for silence removal
 * @returns {Promise<boolean>} - Returns true if successful, false otherwise
 */
export async function removeSilence(inputFile, outputFile, silenceThresholdDb = -35.0, options = {}) {
    try {
        // Default options
        const {
            startThreshold = silenceThresholdDb,
            stopThreshold = silenceThresholdDb,
            startDuration = 0.05,  // 50ms minimum duration for silence at the start
            stopDuration = 0.05,   // 50ms minimum duration for silence in the middle/end
            detectionMethod = 'rms', // 'rms' is more aggressive than 'peak'
            startPeriods = 1,       // Number of silence periods to remove from start
            stopPeriods = -1,       // -1 means all silence periods
            stopSilence = 0         // Seconds of each removed pause to keep (0 = cut it entirely)
        } = options;

        console.log(`Removing silence with thresholds: start=${startThreshold}dB, stop=${stopThreshold}dB`);
        console.log(`Silence durations: start=${startDuration}s, stop=${stopDuration}s, method=${detectionMethod}`);

        // Build ffmpeg command for silence removal
        // silenceThresholdDb is the volume level below which is considered silence
        // minDuration is the minimum duration of a silence period to be removed
        // startDuration and stopDuration correspond to minDuration
        const silenceFilter = (
            `silenceremove=start_periods=${startPeriods}:start_duration=${startDuration}:` +
            `start_threshold=${startThreshold}dB:detection=${detectionMethod},` +
            `silenceremove=stop_periods=${stopPeriods}:stop_duration=${stopDuration}:` +
            `stop_threshold=${stopThreshold}dB:detection=${detectionMethod}` +
            (stopSilence > 0 ? `:stop_silence=${stopSilence}` : '')
        );

        const command = `ffmpeg -i "${inputFile}" -af "${silenceFilter}" -y "${outputFile}"`;
        console.log(`Executing command: ${command}`);

        // Execute ffmpeg command
        const { stdout, stderr } = await execAsync(command);

        // FFmpeg outputs to stderr even on success, so we need to check for specific error indicators
        if (stderr) {
            console.log(`FFmpeg output: ${stderr}`);
            if (stderr.toLowerCase().includes('error') || stderr.toLowerCase().includes('invalid')) {
                console.error(`FFmpeg silence removal error detected`);
                return false;
            }
        }

        // Verify file exists and has content
        const fileExists = fs.existsSync(outputFile);
        if (fileExists) {
            try {
                const stats = fs.statSync(outputFile);
                console.log(`Output file size: ${stats.size} bytes`);

                // Get and log the duration difference to verify silence was removed
                const { stdout: originalDurationStdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputFile}"`);
                const { stdout: newDurationStdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputFile}"`);

                const originalDuration = parseFloat(originalDurationStdout);
                const newDuration = parseFloat(newDurationStdout);
                const reductionPercent = ((originalDuration - newDuration) / originalDuration) * 100;

                console.log(`Silence removal stats: Original=${originalDuration.toFixed(2)}s, New=${newDuration.toFixed(2)}s, Reduction=${reductionPercent.toFixed(1)}%`);

                if (stats.size < 1000) {
                    console.warn('Output file is suspiciously small, might be corrupted');
                }
            } catch (err) {
                console.error(`Error checking output file: ${err.message}`);
            }
        } else {
            console.error('Output file was not created');
        }

        return fileExists;
    } catch (error) {
        console.error(`Error in silence removal: ${error.message}`);
        console.error(error.stack);
        return false;
    }
}

/**
 * Prepares audio by removing silence (with Slicr-style parameters)
 * @param {string} inputPath - Input file path
 * @param {string} outputPath - Output file path
 * @param {Object} slicrSettings - Slicr settings (thresholdDb, minDuration, etc.)
 * @returns {Promise<void>}
 */
export async function prepareAudio(inputPath, outputPath, slicrSettings = {}) {
    const {
        thresholdDb = -35.0,
        minDuration = 0.05,
        leftPadding = 0.05,
        rightPadding = 0.05
    } = slicrSettings;

    const silenceOptions = {
        startThreshold: thresholdDb,
        stopThreshold: thresholdDb,
        startDuration: minDuration,
        stopDuration: minDuration,
        detectionMethod: 'rms',
    };

    // Note: FFmpeg's silenceremove doesn't have direct "padding" in the same way Slicr does,
    // but the start/stop duration and thresholds act similarly.
    // For true Slicr behavior, we'd need more complex segment-based processing.

    const silenceRemoved = await removeSilence(inputPath, outputPath, thresholdDb, silenceOptions);

    if (!silenceRemoved) {
        console.error('Silence removal failed, using original audio');
        await fs.promises.copyFile(inputPath, outputPath);
    }
}

/**
 * Applies speed/pitch change using pure resampling
 * @param {string} inputPath - Input file path
 * @param {string} outputPath - Output file path
 * @param {number} speedFactor - Speed multiplier
 * @returns {Promise<void>}
 */
export async function applyAudioSpeed(inputPath, outputPath, speedFactor) {
    const baseRate = await getAudioSampleRate(inputPath);

    // Calculate new sample rate for resampling
    // Formula: new_rate = old_rate * speed_multiplier
    const newSampleRate = Math.round(baseRate * speedFactor);
    console.log(`Target sample rate for resampling: ${newSampleRate} Hz (Base: ${baseRate} Hz * ${speedFactor}x)`);

    // Apply pure resampling
    console.log(`Applying pure resampling: asetrate=${newSampleRate}, resample back to ${baseRate}`);

    await execAsync(`ffmpeg -i "${inputPath}" -af "asetrate=${newSampleRate}" -ar ${baseRate} -y "${outputPath}"`);
}

/**
 * Applies time stretch using atempo filter (changes speed without affecting pitch)
 * @param {string} inputPath - Input file path
 * @param {string} outputPath - Output file path
 * @param {number} speedFactor - Speed multiplier (e.g., 1.5 for 1.5x speed)
 * @returns {Promise<void>}
 */
export async function applyTimeStretch(inputPath, outputPath, speedFactor) {
    console.log(`Applying time stretch: ${speedFactor}x`);

    // FFmpeg 'atempo' filter supports range 0.5 to 2.0.
    // For values outside this range, we need to chain filters.
    let filter = '';
    let remainingFactor = speedFactor;

    // Handle speed up (> 1.0)
    if (speedFactor > 1.0) {
        while (remainingFactor > 2.0) {
            filter += 'atempo=2.0,';
            remainingFactor /= 2.0;
        }
        filter += `atempo=${remainingFactor}`;
    }
    // Handle slow down (< 1.0)
    else if (speedFactor < 1.0) {
        while (remainingFactor < 0.5) {
            filter += 'atempo=0.5,';
            remainingFactor /= 0.5;
        }
        filter += `atempo=${remainingFactor}`;
    }
    // Handle exactly 1.0 (no change, just copy)
    else {
        await fs.promises.copyFile(inputPath, outputPath);
        return;
    }

    // Get source sample rate to preserve audio quality
    const sampleRate = await getAudioSampleRate(inputPath);

    // Build robust ffmpeg command with proper encoding options:
    // -fflags +genpts: Generate presentation timestamps BEFORE input for proper sync
    // aresample=async=1: Ensures audio stays in sync and properly flushes buffers at end
    // -ar: Preserve original sample rate
    // -b:a 192k: High quality bitrate to prevent degradation at end of file
    // -acodec libmp3lame: Explicit encoder for reliable buffer flushing
    // -q:a 0: Highest quality VBR setting
    const command = `ffmpeg -fflags +genpts -i "${inputPath}" -af "aresample=async=1,${filter}" -ar ${sampleRate} -b:a 192k -acodec libmp3lame -q:a 0 -y "${outputPath}"`;
    console.log(`Executing time stretch command: ${command}`);

    try {
        await execAsync(command);

        // Verify output file was created and has reasonable size
        const stats = fs.statSync(outputPath);
        if (stats.size < 1000) {
            console.warn(`[TimeStretch] Warning: Output file is suspiciously small (${stats.size} bytes)`);
        }
        console.log(`[TimeStretch] Success: Output file size ${stats.size} bytes`);
    } catch (error) {
        console.error('Error applying time stretch:', error);
        throw error;
    }
}

/**
 * Processes audio using Slicr settings
 * @param {string} inputPath - Path to input audio file
 * @param {string} outputPath - Path to output audio file
 * @param {Object} slicrSettings - Slicr settings from preset
 * @returns {Promise<void>}
 */
export async function processAudio(inputPath, outputPath, slicrSettings = {}) {
    console.log('Processing audio with Slicr settings:', slicrSettings);

    try {
        const { stdout: durationStdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`);
        const originalDuration = parseFloat(durationStdout);

        // 1. Remove Silence
        const silenceRemovedTemp = outputPath + '.silence-removed.wav';
        await prepareAudio(inputPath, silenceRemovedTemp, slicrSettings);

        // 2. Get duration after silence removal
        const { stdout: noSilenceDurationStdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${silenceRemovedTemp}"`);
        const noSilenceDuration = parseFloat(noSilenceDurationStdout);

        // 3. Calculate speed factor to hit target duration
        let speedFactor = 1.0;
        if (slicrSettings.targetDuration && slicrSettings.targetDuration > 0) {
            speedFactor = noSilenceDuration / slicrSettings.targetDuration;
            // Cap speed factor for safety
            speedFactor = Math.min(Math.max(speedFactor, 0.5), 2.5);
            console.log(`Calculated speed factor to hit target duration: ${speedFactor.toFixed(2)}x`);
        } else if (slicrSettings.audioSpeed) {
            speedFactor = slicrSettings.audioSpeed;
        }

        // 4. Apply speed
        await applyAudioSpeed(silenceRemovedTemp, outputPath, speedFactor);

        // 5. Add Background Music if requested
        if (slicrSettings.addBackgroundMusic) {
            console.log('Background music requested but logic not yet implemented in processAudio - skipping for now');
            // This would require a separate utility or direct FFmpeg mix
        }

        // Clean up temporary files
        await cleanupFiles([silenceRemovedTemp]);

        // Verify final duration
        const { stdout: finalDurationStdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`);
        const finalDuration = parseFloat(finalDurationStdout);

        console.log('Final audio duration:', {
            originalDuration,
            noSilenceDuration,
            finalDuration,
            actualSpeedFactor: noSilenceDuration / finalDuration
        });

    } catch (error) {
        console.error('Error processing audio:', error);
        throw error;
    }
}

/**
 * Transcribes audio and gets word-level timestamps
 * @param {string} audioPath - Path to the audio file
 * @param {string} elevenlabsApiKey - ElevenLabs API key
 * @param {string} openaiApiKey - OpenAI API key
 * @param {string} channelStyle - Channel style (default: 'grouped')
 * @param {string|null} openrouterApiKey - OpenRouter API key
 * @returns {Promise<Array>} - Array of processed words with timing
 */
export async function transcribeAudio(audioPath, elevenlabsApiKey, openaiApiKey, channelStyle = 'grouped', openrouterApiKey = null, groqApiKey = null) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2 seconds

    // Prefer Groq for word timings when a key is available. Same word-level
    // timestamps as ElevenLabs scribe_v1, but it does not bill per minute.
    // Inert when unconfigured, so existing deployments are unaffected.
    const groqAvailable = isGroqConfigured(groqApiKey);
    if (groqAvailable) {
        try {
            const groqResult = await transcribeWithGroq(audioPath, groqApiKey);
            const processedWords = processTranscriptionResponse(groqResult);
            console.log(`[Groq] Transcribed into ${processedWords.length} words`);
            return processedWords;
        } catch (groqError) {
            console.error(`[Groq] failed, falling back to ElevenLabs: ${groqError.message}`);
        }
    }

    // Validate API keys at the beginning
    if (!elevenlabsApiKey || elevenlabsApiKey.trim() === '') {
        console.error('ElevenLabs API key is missing or empty');
        throw new Error(
            groqAvailable
                ? 'Groq transcription failed and no ElevenLabs key is configured as a fallback'
                : 'ElevenLabs API key is required for transcription'
        );
    }

    const hasOpenAI = openaiApiKey && openaiApiKey.trim() !== '';
    const hasOpenRouter = openrouterApiKey && openrouterApiKey.trim() !== '';

    if (!hasOpenAI && !hasOpenRouter) {
        console.warn('Neither OpenAI nor OpenRouter API key is available - color analysis will be skipped');
    } else if (hasOpenAI) {
        console.log('OpenAI API key is present for color analysis');
    } else {
        console.log('OpenRouter API key is present for color analysis');
    }

    // Helper function to process transcription response
    function processTranscriptionResponse(response) {
        // Process the words from the response
        const fps = 30;
        const processedWords = [];

        // Calculate frames for each word
        for (let i = 0; i < response.words.length; i++) {
            const word = response.words[i];
            const startFrame = Math.round(word.start * fps);
            const endFrame = Math.round(word.end * fps);

            processedWords.push({
                text: word.text,
                startFrame,
                endFrame,
                color: 'white' // Default color, will be updated later
            });
        }

        return processedWords;
    }

    // Helper function to create fallback word timings
    async function createFallbackWordTimings(audioPath, text, channelStyle) {
        console.log('Creating fallback word timings...');

        // Get audio duration
        const { stdout: durationStdout } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`);
        const durationInSeconds = parseFloat(durationStdout);

        // Split text into words or word groups
        let words;
        if (channelStyle === 'single') {
            words = text.split(' ').filter(word => word.trim() !== '');
        } else {
            // For grouped style, create groups of 2-4 words
            const allWords = text.split(' ').filter(word => word.trim() !== '');
            words = [];
            let currentGroup = '';
            let wordCount = 0;

            for (const word of allWords) {
                if (wordCount === 0) {
                    currentGroup = word;
                    wordCount = 1;
                } else if (wordCount < 3) {
                    currentGroup += ' ' + word;
                    wordCount++;
                } else {
                    words.push(currentGroup);
                    currentGroup = word;
                    wordCount = 1;
                }
            }

            if (currentGroup) {
                words.push(currentGroup);
            }
        }

        // Calculate frames per word
        const fps = 30;
        const totalFrames = Math.ceil(durationInSeconds * fps);
        const framesPerWord = Math.floor(totalFrames / words.length);

        // Create evenly spaced word timings
        const processedWords = [];
        for (let i = 0; i < words.length; i++) {
            const startFrame = i * framesPerWord;
            const endFrame = (i === words.length - 1) ? totalFrames : (i + 1) * framesPerWord;

            processedWords.push({
                text: words[i],
                startFrame,
                endFrame,
                color: 'white' // Default color for fallback
            });
        }

        console.log(`Created fallback timings for ${processedWords.length} words`);
        return processedWords;
    }

    // Try to get transcription with retries using ElevenLabsClient
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`Transcription attempt ${attempt}/${MAX_RETRIES} using ElevenLabsClient...`);

            // Validate the audio file before sending
            try {
                const stats = fs.statSync(audioPath);
                const fileSizeInMB = stats.size / (1024 * 1024);
                console.log(`Audio file size: ${fileSizeInMB.toFixed(2)} MB`);

                // Check if file exists and is not too large
                if (!stats.isFile()) {
                    throw new Error(`Not a valid file: ${audioPath}`);
                }

                // ElevenLabs has a file size limit (check their docs for exact limit)
                if (fileSizeInMB > 25) {
                    console.warn(`File size (${fileSizeInMB.toFixed(2)} MB) may exceed ElevenLabs limits`);
                }

                // Check file format using ffprobe
                const { stdout: formatInfo } = await execAsync(`ffprobe -v error -show_entries format=format_name -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`);
                console.log(`Audio format: ${formatInfo.trim()}`);

                // ElevenLabs supports MP3, WAV, etc. - check if format is supported
                const supportedFormats = ['mp3', 'wav', 'mp4', 'm4a', 'webm'];
                const detectedFormat = formatInfo.trim().split(',')[0]; // Get the first format if multiple are detected

                if (!supportedFormats.includes(detectedFormat)) {
                    console.warn(`Audio format ${detectedFormat} may not be supported by ElevenLabs`);
                }
            } catch (validationError) {
                console.error(`File validation error: ${validationError.message}`);
                throw validationError;
            }

            // Use ElevenLabsClient to perform the transcription
            console.log('Using ElevenLabsClient to transcribe audio...');
            const client = new ElevenLabsClient({ apiKey: elevenlabsApiKey });

            // Create a read stream for the audio file
            const fileStream = fs.createReadStream(audioPath);

            // Call the speechToText.convert method
            const directData = await client.speechToText.convert({
                file: fileStream,
                model_id: 'scribe_v1'
            });

            console.log("ElevenLabsClient transcription succeeded!");

            // Process the response
            if (!directData || !directData.text || !directData.words || directData.words.length === 0) {
                throw new Error('Invalid response from ElevenLabs API call');
            }

            // Process the transcription response
            const processedWords = processTranscriptionResponse(directData);

            // Skip color analysis - user requested removal
            console.log('Skipping color analysis as requested');
            console.log(`Transcribed into ${processedWords.length} words (all white)`);
            return processedWords;

        } catch (error) {
            console.error(`Transcription attempt ${attempt} failed with error: ${error.message}`);
            console.error(error.stack);

            if (attempt < MAX_RETRIES) {
                console.log(`Waiting ${RETRY_DELAY / 1000} seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            } else {
                console.warn('All transcription attempts failed, using fallback method');
                // Get the script text from the audio file name
                const audioFileName = path.basename(audioPath);
                const scriptText = audioFileName.includes('script') ?
                    fs.existsSync(path.join(path.dirname(audioPath), '..', 'transcriptions', 'script_text.txt')) ?
                        fs.readFileSync(path.join(path.dirname(audioPath), '..', 'transcriptions', 'script_text.txt'), 'utf8') :
                        'Script text not available' :
                    'Audio content';

                return await createFallbackWordTimings(audioPath, scriptText, channelStyle);
            }
        }
    }
}
