import axios from 'axios';

const SCRIPZ_API_URL = 'https://www.scripz.lol/api';
// Read at call time: this module is imported before server.js runs dotenv.config().
const getScripzApiKey = () => {
    const key = process.env.SCRIPZ_API_KEY;
    if (!key) throw new Error('SCRIPZ_API_KEY is not set (add it to .env)');
    return key;
};

class ScripzService {
    /**
     * Get transcript for a YouTube video
     * @param {string} videoIdOrUrl - YouTube video ID or full URL
     * @returns {Promise<Object>} Transcript object { video_id, language, full_text }
     */
    async getTranscript(videoIdOrUrl) {
        try {
            let videoUrl = videoIdOrUrl;
            // If it's just an ID, construct the URL
            if (!videoIdOrUrl.includes('youtube.com') && !videoIdOrUrl.includes('youtu.be')) {
                videoUrl = `https://www.youtube.com/watch?v=${videoIdOrUrl}`;
            }

            console.log(`[Scripz] Fetching transcript for: ${videoUrl}`);

            const response = await axios.post(
                `${SCRIPZ_API_URL}/get_transcript`,
                {
                    video_url: videoUrl
                },
                {
                    headers: {
                        'X-API-Key': getScripzApiKey(),
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000 // 60s timeout
                }
            );

            if (response.data && response.data.full_text) {
                // Remove [music] tags
                response.data.full_text = response.data.full_text.replace(/\[music\]/gi, '');
                console.log(`[Scripz] Transcript fetched successfully (${response.data.full_text.length} chars, cleaned music tags)`);
                return response.data;
            } else {
                throw new Error('Invalid response format from Scripz API');
            }

        } catch (error) {
            console.error('[Scripz] Error fetching transcript:', error.message);
            // Enhance error message if possible
            if (error.response && error.response.data && error.response.data.error) {
                throw new Error(`Scripz API Error: ${error.response.data.error}`);
            }
            throw new Error(`Failed to fetch transcript: ${error.message}`);
        }
    }
}

export const scripzService = new ScripzService();
