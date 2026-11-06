import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';

// Tokens read within methods to ensure dotenv is loaded

class TelegramService {
    constructor() {
        this.bot = null;
        // Don't initialize in constructor as env vars might not be loaded yet
    }

    initialize() {
        // Read token from env at initialization time, not module load time
        const token = process.env.TELEGRAM_BOT_TOKEN;

        if (!token) {
            console.warn('[Telegram] Bot token not configured. Telegram features will be disabled.');
            return;
        }

        try {
            this.bot = new TelegramBot(token, { polling: false });
            console.log('[Telegram] Bot initialized successfully');
        } catch (error) {
            console.error('[Telegram] Failed to initialize bot:', error.message);
        }
    }

    /**
     * Send a video file to a Telegram chat
     * @param {string} chatId - Telegram chat ID
     * @param {string} videoPath - Path to the video file
     * @param {string} caption - Optional caption for the video
     * @returns {Promise<Object>} Telegram API response
     */
    async sendVideo(chatId, videoPath, caption = '') {
        if (!this.bot) {
            this.initialize();
            if (!this.bot) {
                throw new Error('Telegram bot not initialized. Please configure TELEGRAM_BOT_TOKEN.');
            }
        }

        if (!fs.existsSync(videoPath)) {
            throw new Error(`Video file not found: ${videoPath}`);
        }

        try {
            console.log(`[Telegram] Sending video to chat ${chatId}: ${path.basename(videoPath)}`);

            const result = await this.bot.sendVideo(chatId, videoPath, {
                caption: caption || `🎬 ${path.basename(videoPath)}`,
                supports_streaming: true,
            });

            console.log('[Telegram] Video sent successfully');
            return result;
        } catch (error) {
            console.error('[Telegram] Error sending video:', error.message);
            throw new Error(`Failed to send video via Telegram: ${error.message}`);
        }
    }

    /**
     * Send a text message to a Telegram chat
     * @param {string} chatId - Telegram chat ID
     * @param {string} text - Message text
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Telegram API response
     */
    async sendMessage(chatId, text, options = {}) {
        if (!this.bot) {
            this.initialize();
            if (!this.bot) {
                throw new Error('Telegram bot not initialized. Please configure TELEGRAM_BOT_TOKEN.');
            }
        }

        try {
            console.log(`[Telegram] Sending message to chat ${chatId}`);

            const result = await this.bot.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                ...options,
            });

            console.log('[Telegram] Message sent successfully');
            return result;
        } catch (error) {
            console.error('[Telegram] Error sending message:', error.message);
            throw new Error(`Failed to send message via Telegram: ${error.message}`);
        }
    }

    /**
     * Send a notification about cron job completion
     * @param {string} chatId - Telegram chat ID
     * @param {Object} jobInfo - Job information
     * @param {string} videoPath - Path to generated video
     */
    async sendCronJobNotification(chatId, jobInfo, videoPath) {
        try {
            const caption = `
✅ <b>Cron Job Completed</b>

📋 Job: ${jobInfo.name}
⏰ Completed: ${new Date().toLocaleString()}
🎬 Video: ${path.basename(videoPath)}
      `.trim();

            await this.sendVideo(chatId, videoPath, caption);
        } catch (error) {
            console.error('[Telegram] Failed to send cron job notification:', error);
            // Try to send error message instead
            try {
                await this.sendMessage(
                    chatId,
                    `❌ Failed to send video for job "${jobInfo.name}": ${error.message}`
                );
            } catch (msgError) {
                console.error('[Telegram] Failed to send error notification:', msgError);
            }
        }
    }

    /**
     * Send an error notification
     * @param {string} chatId - Telegram chat ID
     * @param {string} jobName - Job name
     * @param {string} errorMessage - Error message
     */
    async sendErrorNotification(chatId, jobName, errorMessage) {
        try {
            const message = `
❌ <b>Cron Job Failed</b>

📋 Job: ${jobName}
⏰ Time: ${new Date().toLocaleString()}
⚠️ Error: ${errorMessage}
      `.trim();

            await this.sendMessage(chatId, message);
        } catch (error) {
            console.error('[Telegram] Failed to send error notification:', error);
        }
    }

    /**
     * Get bot information
     * @returns {Promise<Object>} Bot information
     */
    async getBotInfo() {
        if (!this.bot) {
            this.initialize();
            if (!this.bot) {
                throw new Error('Telegram bot not initialized');
            }
        }

        try {
            const info = await this.bot.getMe();
            return info;
        } catch (error) {
            throw new Error(`Failed to get bot info: ${error.message}`);
        }
    }

    /**
     * Test the bot connection by sending a test message
     * @param {string} chatId - Chat ID to test
     * @returns {Promise<boolean>} Success status
     */
    async testConnection(chatId) {
        try {
            await this.sendMessage(
                chatId,
                '✅ <b>Connection Test Successful!</b>\n\nYour Get Brainrot bot is configured correctly.'
            );
            return true;
        } catch (error) {
            console.error('[Telegram] Connection test failed:', error);
            return false;
        }
    }
}

export const telegramService = new TelegramService();
