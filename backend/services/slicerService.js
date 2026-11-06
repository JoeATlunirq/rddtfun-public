import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SLICR_API_URL = process.env.SLICR_API_URL || 'https://www.slicr.me';
const SLICR_API_KEY = process.env.SLICR_API_KEY;

class SlicerService {
    /**
     * Process audio file using Slicr.me API
     * @param {string} audioFilePath - Path to the audio file to process
     * @param {Object} params - Processing parameters
     * @returns {Promise<Object>} Processed audio URLs
     */
    async processAudio(audioFilePath, params = {}) {
        try {
            if (!SLICR_API_KEY) {
                throw new Error('Slicr.me API key not configured');
            }

            if (!fs.existsSync(audioFilePath)) {
                throw new Error(`Audio file not found: ${audioFilePath}`);
            }

            console.log('[Slicr] Processing audio file:', audioFilePath);

            // Step 1: Get pre-signed upload URL
            const fileName = path.basename(audioFilePath);
            const contentType = this.getContentType(fileName);

            const uploadUrlResponse = await this.getUploadUrl(fileName, contentType);
            const { uploadUrl, s3Key } = uploadUrlResponse;

            // Step 2: Upload file to S3
            await this.uploadToS3(audioFilePath, uploadUrl, contentType);

            // Step 3: Process the file
            const processParams = {
                thresholdDb: params.thresholdDb || -40,
                minDuration: params.minDuration || 0.2,
                leftPadding: params.leftPadding || 0.05,
                rightPadding: params.rightPadding || 0.05,
                targetDuration: params.targetDuration || null,
                transcribe: params.transcribe || false,
                exportFormat: params.exportFormat || 'mp3',
                addBackgroundMusic: params.addBackgroundMusic || false,
                autoSelectMusicTrack: params.autoSelectMusicTrack || false,
                selectedMusicTrackId: params.selectedMusicTrackId || null,
                musicVolumeDb: params.musicVolumeDb || -18,
                responseFormat: params.responseFormat || 'url',
            };

            const result = await this.processFile(s3Key, processParams);

            console.log('[Slicr] Audio processing complete');

            return {
                success: true,
                audioUrl: result.audioUrl,
                srtUrl: result.srtUrl,
            };
        } catch (error) {
            console.error('[Slicr] Error processing audio:', error.message);
            throw new Error('Failed to process audio with Slicr.me: ' + error.message);
        }
    }

    /**
     * Get pre-signed upload URL from Slicr.me
     * @param {string} fileName - Name of the file
     * @param {string} contentType - MIME type of the file
     * @returns {Promise<Object>} Upload URL and S3 key
     */
    async getUploadUrl(fileName, contentType) {
        try {
            const response = await axios.post(
                `${SLICR_API_URL}/api/generate-upload-url`,
                {
                    fileName,
                    contentType,
                },
                {
                    headers: {
                        'X-API-Key': SLICR_API_KEY,
                        'Content-Type': 'application/json',
                    },
                    timeout: 30000,
                }
            );

            if (!response.data.success) {
                throw new Error(response.data.error || 'Failed to get upload URL');
            }

            return {
                uploadUrl: response.data.uploadUrl,
                s3Key: response.data.s3Key,
            };
        } catch (error) {
            throw new Error('Failed to get upload URL: ' + (error.response?.data?.error || error.message));
        }
    }

    /**
     * Upload file to S3 using pre-signed URL
     * @param {string} filePath - Path to the file to upload
     * @param {string} uploadUrl - Pre-signed S3 URL
     * @param {string} contentType - MIME type
     */
    async uploadToS3(filePath, uploadUrl, contentType) {
        try {
            const fileBuffer = fs.readFileSync(filePath);

            await axios.put(uploadUrl, fileBuffer, {
                headers: {
                    'Content-Type': contentType,
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 120000, // 2 minute timeout for large files
            });

            console.log('[Slicr] File uploaded to S3 successfully');
        } catch (error) {
            throw new Error('Failed to upload file to S3: ' + error.message);
        }
    }

    /**
     * Process the uploaded file
     * @param {string} s3Key - S3 key of the uploaded file
     * @param {Object} params - Processing parameters
     * @returns {Promise<Object>} Processing result
     */
    async processFile(s3Key, params) {
        try {
            const response = await axios.post(
                `${SLICR_API_URL}/api/process`,
                {
                    s3Key,
                    params,
                },
                {
                    headers: {
                        'X-API-Key': SLICR_API_KEY,
                        'Content-Type': 'application/json',
                    },
                    timeout: 300000, // 5 minute timeout for processing
                }
            );

            if (!response.data.success) {
                throw new Error(response.data.error || 'Processing failed');
            }

            return {
                audioUrl: response.data.audioUrl,
                srtUrl: response.data.srtUrl,
            };
        } catch (error) {
            throw new Error('Failed to process file: ' + (error.response?.data?.error || error.message));
        }
    }

    /**
     * Get content type from file extension
     * @param {string} fileName - File name
     * @returns {string} MIME type
     */
    getContentType(fileName) {
        const ext = path.extname(fileName).toLowerCase();
        const contentTypes = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.m4a': 'audio/mp4',
            '.aac': 'audio/aac',
            '.ogg': 'audio/ogg',
            '.flac': 'audio/flac',
        };
        return contentTypes[ext] || 'audio/mpeg';
    }
}

export const slicerService = new SlicerService();
