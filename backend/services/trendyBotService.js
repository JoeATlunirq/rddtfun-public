import axios from 'axios';

const TRENDY_BOT_API_URL = process.env.TRENDY_BOT_API_URL || 'https://trendybot-backend-production.up.railway.app';

class TrendyBotService {
    /**
     * Submit a research job to Trendy Bot API
     * @param {Object} config - Research job configuration
     * @param {string} apiKey - Optional API key (falls back to env)
     * @returns {Promise<Object>} Job submission result with jobId and statusUrl
     */
    async submitResearchJob(config, apiKey = null) {
        try {
            const {
                channelIds = [],
                channelHandles = [],
                mode = 'content_discovery',
                source = 'viewstats',
                timeFrame = '28d',
                minViews,
                maxVideos,
                youtubeApiKeys = [],
            } = config;

            const effectiveApiKey = apiKey || process.env.TRENDY_BOT_API_KEY;

            if (!effectiveApiKey) {
                throw new Error('Trendy Bot API key not configured');
            }

            if (channelIds.length === 0 && channelHandles.length === 0) {
                throw new Error('At least one channel ID or handle is required');
            }

            const requestBody = {
                channelIds: channelIds.length > 0 ? channelIds : undefined,
                channelHandles: channelHandles.length > 0 ? channelHandles : undefined,
                mode,
                source,
                timeFrame,
            };

            if (minViews !== undefined) {
                requestBody.minViews = minViews;
            }

            if (maxVideos !== undefined) {
                requestBody.maxVideos = maxVideos;
            }

            if (source === 'youtube' && youtubeApiKeys.length > 0) {
                requestBody.youtubeApiKeys = youtubeApiKeys;
            }

            console.log('[Trendy Bot] Submitting research job:', requestBody);

            const response = await axios.post(
                `${TRENDY_BOT_API_URL}/api/v1/access/research`,
                requestBody,
                {
                    headers: {
                        'x-api-key': effectiveApiKey,
                        'Content-Type': 'application/json',
                    },
                    timeout: 30000, // 30 second timeout
                }
            );

            console.log('[Trendy Bot] Job submitted successfully:', response.data);

            return {
                success: true,
                jobId: response.data.jobId,
                statusUrl: response.data.statusUrl,
                message: response.data.message,
            };
        } catch (error) {
            console.error('[Trendy Bot] Error submitting research job:', error.response?.data || error.message);
            throw new Error(
                error.response?.data?.error ||
                error.response?.data?.message ||
                'Failed to submit research job to Trendy Bot'
            );
        }
    }

    /**
     * Get the status and results of a research job
     * @param {string} jobId - The job ID to check
     * @param {string} apiKey - Optional API key (falls back to env)
     * @returns {Promise<Object>} Job status and results
     */
    async getResearchJobStatus(jobId, apiKey = null) {
        try {
            const effectiveApiKey = apiKey || process.env.TRENDY_BOT_API_KEY;

            if (!effectiveApiKey) {
                throw new Error('Trendy Bot API key not configured');
            }

            console.log(`[Trendy Bot] Checking job status for: ${jobId}`);

            const response = await axios.get(
                `${TRENDY_BOT_API_URL}/api/v1/access/research/${jobId}`,
                {
                    headers: {
                        'x-api-key': effectiveApiKey,
                    },
                    timeout: 30000,
                }
            );

            const { id, status, created_at, completed_at, result_payload } = response.data;

            console.log(`[Trendy Bot] Job ${jobId} status: ${status}`);

            return {
                success: true,
                id,
                status, // 'pending', 'processing', 'completed', 'failed'
                created_at,
                completed_at,
                results: Array.isArray(result_payload) ? result_payload : (result_payload?.results || []),
                errors: result_payload?.errors || [],
            };
        } catch (error) {
            console.error('[Trendy Bot] Error fetching job status:', error.response?.data || error.message);
            throw new Error(
                error.response?.data?.error ||
                error.response?.data?.message ||
                'Failed to fetch job status from Trendy Bot'
            );
        }
    }

    /**
     * Poll a research job until completion
     * @param {string} jobId - The job ID to poll
     * @param {string} apiKey - Optional API key (falls back to env)
     * @param {number} maxAttempts - Maximum number of polling attempts
     * @param {number} intervalMs - Interval between polls in milliseconds
     * @returns {Promise<Object>} Final job results
     */
    async pollJobUntilComplete(jobId, apiKey = null, maxAttempts = 60, intervalMs = 5000) {
        let attempts = 0;

        while (attempts < maxAttempts) {
            const jobStatus = await this.getResearchJobStatus(jobId, apiKey);

            if (jobStatus.status === 'completed') {
                return jobStatus;
            }

            if (jobStatus.status === 'failed') {
                throw new Error('Research job failed: ' + (jobStatus.errors[0] || 'Unknown error'));
            }

            attempts++;
            console.log(`[Trendy Bot] Polling attempt ${attempts}/${maxAttempts}, status: ${jobStatus.status}`);

            if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }

        throw new Error('Research job polling timeout - job did not complete in time');
    }
}

export const trendyBotService = new TrendyBotService();
