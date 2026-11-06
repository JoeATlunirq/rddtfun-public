import fetch from 'node-fetch';
import fs from 'fs';

// Helper to get Slicr configuration
function getSlicrConfig() {
    const apiUrl = process.env.SLICR_API_URL || 'https://www.slicr.me';
    const apiKey = process.env.SLICR_API_KEY;
    if (!apiKey) {
        console.warn('SLICR_API_KEY not found in environment variables');
    }
    return { apiUrl, apiKey };
}

/**
 * Uploads a file to Slicr via S3 Presigned URL
 * @param {string} filePath - Path to the local file to upload
 * @param {string} contentType - Mime type of the file
 * @returns {Promise<string>} - The S3 Key of the uploaded file
 */
export async function uploadToSlicr(filePath, contentType = 'audio/mpeg') {
    const { apiUrl, apiKey } = getSlicrConfig();
    const fileName = filePath.split('/').pop();

    try {
        // 1. Get Presigned URL
        console.log(`[SlicrUtils] Requesting upload URL for ${fileName}...`);
        const initResponse = await fetch(`${apiUrl}/api/generate-upload-url`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({ fileName, contentType })
        });

        if (!initResponse.ok) {
            throw new Error(`Failed to get upload URL: ${initResponse.statusText}`);
        }

        const initData = await initResponse.json();
        if (!initData.success) {
            throw new Error(`Slicr API Error: ${initData.error}`);
        }

        const { uploadUrl, s3Key } = initData;

        // 2. Upload to S3
        console.log(`[SlicrUtils] Uploading file to S3 (${s3Key})...`);
        const fileBuffer = fs.readFileSync(filePath);

        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': contentType
            },
            body: fileBuffer
        });

        if (!uploadResponse.ok) {
            throw new Error(`Failed to upload file to S3: ${uploadResponse.statusText}`);
        }

        console.log('[SlicrUtils] Upload successful');
        return s3Key;
    } catch (error) {
        console.error('[SlicrUtils] Upload failed:', error);
        throw error;
    }
}

/**
 * Processes a file using Slicr API
 * @param {string} s3Key - S3 Key of the file to process
 * @param {object} settings - Processing settings (from Preset)
 * @returns {Promise<object>} - The processing result (audioUrl, words, etc.)
 */
export async function processWithSlicr(s3Key, settings) {
    const { apiUrl, apiKey } = getSlicrConfig();

    try {
        console.log(`[SlicrUtils] Requesting processing for key: ${s3Key}`);
        console.log('[SlicrUtils] Settings:', JSON.stringify(settings, null, 2));

        const response = await fetch(`${apiUrl}/api/process`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({
                s3Key,
                params: settings // Slicr expects 'params' object
            })
        });

        if (!response.ok) {
            throw new Error(`Slicr Processing Failed: ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(`Slicr API Error: ${data.error}`);
        }

        console.log('[SlicrUtils] Processing initiated/completed successfully');
        return data; // Returns object with { audioUrl, words, transcript, ... }
    } catch (error) {
        console.error('[SlicrUtils] Processing failed:', error);
        throw error;
    }
}
