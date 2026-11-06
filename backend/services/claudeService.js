import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude API Service for generating scripts from video metadata
 */
class ClaudeService {
    /**
     * Generate a hook and script from video metadata
     * @param {Object} videoMetadata - Video data from Trendy Bot research
     * @param {string} customPrompt - Optional custom prompt override
     * @param {string} claudeApiKey - User's Claude API key
     * @returns {Promise<{hook: string, script: string}>}
     */
    async generateScript(videoMetadata, customPrompt, claudeApiKey) {
        if (!claudeApiKey) {
            throw new Error('Claude API key is required for script generation');
        }

        const anthropic = new Anthropic({
            apiKey: claudeApiKey,
        });

        const defaultPrompt = this.getDefaultPrompt();
        const prompt = customPrompt || defaultPrompt;

        const videoContext = this.formatVideoContext(videoMetadata);

        try {
            console.log('[Claude] Generating script for video:', videoMetadata.title);

            const message = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [
                    {
                        role: 'user',
                        content: `${prompt}

Here is the source video information:
${videoContext}

Please generate a new hook and script. The hook should be 1-2 short, attention-grabbing sentences. The script should be 3-6 sentences that tell the story in an engaging way.

Respond in this exact JSON format:
{
    "hook": "Your generated hook here",
    "script": "Your generated script here"
}`
                    }
                ]
            });

            const responseText = message.content[0].text;
            console.log('[Claude] Raw response:', responseText);

            // Parse JSON from response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to parse Claude response as JSON');
            }

            const result = JSON.parse(jsonMatch[0]);

            if (!result.hook || !result.script) {
                throw new Error('Claude response missing hook or script');
            }

            console.log('[Claude] Generated hook:', result.hook);
            console.log('[Claude] Generated script:', result.script);

            return {
                hook: result.hook.trim(),
                script: result.script.trim()
            };

        } catch (error) {
            console.error('[Claude] Error generating script:', error);
            throw new Error(`Claude API error: ${error.message}`);
        }
    }

    /**
     * Format video metadata into context for Claude
     * @param {Object} video - Video metadata object
     * @returns {string} Formatted context string
     */
    formatVideoContext(video) {
        const parts = [];

        if (video.title) parts.push(`Title: ${video.title}`);
        if (video.channel_name || video.channelTitle) parts.push(`Channel: ${video.channel_name || video.channelTitle}`);

        const views = video.latest_view_count || video.viewCount;
        if (views) parts.push(`Views: ${this.formatNumber(views)}`);

        const likes = video.latest_like_count || video.likeCount;
        if (likes) parts.push(`Likes: ${this.formatNumber(likes)}`);

        const published = video.published_at || video.publishedAt;
        if (published) parts.push(`Published: ${new Date(published).toLocaleDateString()}`);

        if (video.description) parts.push(`Description: ${video.description.substring(0, 500)}...`);

        const duration = video.duration_seconds || video.duration;
        if (duration) parts.push(`Duration: ${duration}`);

        if (video.tags && video.tags.length > 0) parts.push(`Tags: ${video.tags.slice(0, 10).join(', ')}`);

        return parts.join('\n');
    }

    /**
     * Format large numbers with K/M suffix
     * @param {number} num - Number to format
     * @returns {string} Formatted string
     */
    formatNumber(num) {
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
        return num.toString();
    }

    /**
     * Get the default prompt for script generation
     * @returns {string} Default prompt
     */
    getDefaultPrompt() {
        return `You are a script writer for viral Reddit-style short form video content. Your job is to create engaging hooks and scripts based on trending video topics.

The content should:
- Be conversational and engaging, like someone telling a story on Reddit
- Start with a hook that immediately grabs attention
- Be suitable for text-to-speech narration
- Feel authentic and relatable
- Be original - don't copy the source directly, create something new inspired by the topic
- Be appropriate for a 30-60 second video

The hook should make viewers want to keep watching. The script should tell an interesting story or share fascinating information.`;
    }

    /**
     * Get algorithm-specific prompts
     * @param {string} algorithmType - Type of algorithm
     * @returns {string} Customized prompt
     */
    getPromptForAlgorithm(algorithmType) {
        const prompts = {
            random: this.getDefaultPrompt(),
            top_videos: `${this.getDefaultPrompt()}

Focus on making the content feel viral and widely appealing. This video performed exceptionally well, so capture what made it engaging.`,
            newest_over_threshold: `${this.getDefaultPrompt()}

This is a newer piece of content that's gaining traction. Keep the content fresh and timely.`
        };

        return prompts[algorithmType] || this.getDefaultPrompt();
    }
}

export const claudeService = new ClaudeService();
