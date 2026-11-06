import cron from 'node-cron';
import { trendyBotService } from './trendyBotService.js';
import { telegramService } from './telegramService.js';
import { claudeService } from './claudeService.js';
import { scripzService } from './scripzService.js';
import { openaiService } from './openaiService.js';
import { generateVideo } from './videoRenderService.js';
import { validateActiveUser } from '../utils/authUtils.js';
import { captionLookFromStyle } from '../render/styles.js';

/**
 * Cron Job Service with Supabase integration
 * Manages scheduling and execution of automated video generation jobs
 */
class CronJobService {
    constructor() {
        this.scheduledJobs = new Map(); // jobId -> cron task
        this.supabase = null;
    }

    /**
     * Initialize the cron job service with Supabase client
     * @param {Object} supabaseClient - Supabase client instance
     */
    async initialize(supabaseClient) {
        this.supabase = supabaseClient;

        if (!this.supabase) {
            console.warn('[Cron] Supabase not configured. Cron jobs will not persist.');
            return;
        }

        // Load and schedule all enabled jobs from database
        try {
            const { data: jobs, error } = await this.supabase
                .from('cron_jobs')
                .select('*')
                .eq('enabled', true);

            if (error) throw error;

            for (const job of jobs || []) {
                await this.scheduleJob(job);
            }

            console.log(`[Cron] Loaded and scheduled ${this.scheduledJobs.size} jobs`);
        } catch (error) {
            console.error('[Cron] Error loading jobs:', error);
        }
    }

    /**
     * Schedule a cron job
     * @param {Object} job - Job configuration from database
     */
    async scheduleJob(job) {
        try {
            // Validate cron expression
            if (!cron.validate(job.schedule)) {
                throw new Error(`Invalid cron expression: ${job.schedule}`);
            }

            // Unschedule if already exists
            if (this.scheduledJobs.has(job.id)) {
                this.unscheduleJob(job.id);
            }

            // Schedule the job
            const task = cron.schedule(job.schedule, async () => {
                console.log(`[Cron] Executing job: ${job.name} (${job.id})`);
                await this.executeJob(job.id);
            });

            this.scheduledJobs.set(job.id, task);
            console.log(`[Cron] Scheduled job: ${job.name} with schedule: ${job.schedule}`);

            // Update next_run in database
            await this.updateNextRun(job.id, job.schedule);

        } catch (error) {
            console.error(`[Cron] Error scheduling job ${job.id}:`, error);
            throw error;
        }
    }

    /**
     * Unschedule a cron job
     * @param {string} jobId - Job ID to unschedule
     */
    unscheduleJob(jobId) {
        const task = this.scheduledJobs.get(jobId);
        if (task) {
            task.stop();
            this.scheduledJobs.delete(jobId);
            console.log(`[Cron] Unscheduled job: ${jobId}`);
        }
    }

    /**
     * Execute a cron job - full pipeline
     * @param {string} jobId - Job ID to execute
     * @param {boolean} isManual - Whether this is a manual trigger
     */
    async executeJob(jobId, isManual = false) {
        if (!this.supabase) {
            throw new Error('Supabase not configured');
        }

        // Fetch the job from database
        const { data: job, error: jobError } = await this.supabase
            .from('cron_jobs')
            .select('*, channel_profiles(*)')
            .eq('id', jobId)
            .single();

        if (jobError || !job) {
            throw new Error(`Job not found: ${jobId}`);
        }

        // Validate user still exists and is active before executing job
        const userValidation = await validateActiveUser(this.supabase, job.user_id);
        if (!userValidation.valid) {
            console.log(`[Cron] User ${job.user_id} is no longer active. Job execution cancelled.`);
            throw new Error(userValidation.error || 'User account is no longer active. Job execution cancelled.');
        }

        // Fetch user settings for API keys
        const { data: userSettings, error: settingsError } = await this.supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', job.user_id)
            .single();

        if (settingsError && settingsError.code !== 'PGRST116') {
            console.error('[Cron] Error fetching user settings:', settingsError);
        }

        // Create execution record
        const { data: execution, error: execError } = await this.supabase
            .from('cron_job_executions')
            .insert({
                cron_job_id: jobId,
                status: 'researching',
                started_at: new Date().toISOString(),
                logs: [{ timestamp: new Date().toISOString(), message: `Starting ${isManual ? 'manual' : 'scheduled'} execution` }]
            })
            .select()
            .single();

        if (execError) {
            console.error('[Cron] Error creating execution record:', execError);
            throw execError;
        }

        const executionId = execution.id;

        try {
            // Step 1: Research via Trendy Bot
            await this.updateExecution(executionId, 'researching', 'Fetching content from Trendy Bot...');

            const algorithmConfig = job.algorithm_config || {};

            // Build YouTube API keys array from user settings
            const youtubeApiKeys = [];
            if (userSettings?.youtube_api_key_1) youtubeApiKeys.push(userSettings.youtube_api_key_1);
            if (userSettings?.youtube_api_key_2) youtubeApiKeys.push(userSettings.youtube_api_key_2);

            // IMPROVEMENT: Retry logic if first channel fails
            let finalVideos = [];
            const maxRetries = 5;
            let attempts = 0;
            let usedHandles = new Set();
            let usedIds = new Set();
            let success = false;

            // Clone target lists so we don't modify originals for next run
            // Ensure handles start with @
            let availableHandles = (algorithmConfig.channelHandles || []).map(h => h.trim().startsWith('@') ? h.trim() : `@${h.trim()}`);
            let availableIds = [...(algorithmConfig.channelIds || [])];

            const isRandomMode = job.algorithm_type === 'random';

            // If not random mode, we just run once with all targets
            // If random mode, we loop until we find videos or run out of attempts/targets

            while ((attempts < maxRetries) && !success) {
                attempts++;
                let currentTargetHandles = [];
                let currentTargetIds = [];

                if (isRandomMode) {
                    // Pick one random channel if available
                    if (availableHandles.length > 0) {
                        const randomIndex = Math.floor(Math.random() * availableHandles.length);
                        const handle = availableHandles[randomIndex];
                        currentTargetHandles = [handle];
                        // Remove from available so we don't pick again
                        availableHandles.splice(randomIndex, 1);
                        console.log(`[Cron] Random Algorithm (Attempt ${attempts}): Selected ${handle}`);
                        await this.logToExecution(executionId, `Random Algorithm (Attempt ${attempts}): Selected ${handle}`);
                    } else if (availableIds.length > 0) {
                        const randomIndex = Math.floor(Math.random() * availableIds.length);
                        const id = availableIds[randomIndex];
                        currentTargetIds = [id];
                        availableIds.splice(randomIndex, 1);
                        console.log(`[Cron] Random Algorithm (Attempt ${attempts}): Selected ID ${id}`);
                        await this.logToExecution(executionId, `Random Algorithm (Attempt ${attempts}): Selected ID ${id}`);
                    } else {
                        // No more targets to try
                        break;
                    }
                } else {
                    // Not random mode: use all provided targets
                    currentTargetHandles = availableHandles;
                    currentTargetIds = availableIds;
                    // Ensure we exit loop after this run
                    attempts = maxRetries;
                }

                if (currentTargetHandles.length === 0 && currentTargetIds.length === 0) {
                    break;
                }

                const researchConfig = {
                    channelIds: currentTargetIds,
                    channelHandles: currentTargetHandles,
                    mode: 'content_discovery',
                    source: 'youtube', // Always use YouTube API
                    timeFrame: algorithmConfig.timeFrame || '28d',
                    minViews: algorithmConfig.minViews,
                    maxVideos: algorithmConfig.maxVideos || 10,
                    youtubeApiKeys: youtubeApiKeys,
                };

                try {
                    const trendyApiKey = userSettings?.trendy_bot_api_key;
                    const researchJob = await trendyBotService.submitResearchJob(researchConfig, trendyApiKey);
                    await this.logToExecution(executionId, `Research job sbumitted: ${researchJob.jobId}`);

                    // Poll for results
                    const results = await trendyBotService.pollJobUntilComplete(researchJob.jobId, trendyApiKey);
                    console.log('[DEBUG] Full Research Results:', JSON.stringify(results, null, 2));

                    // Flatten videos
                    if (results.results && Array.isArray(results.results)) {
                        results.results.forEach(item => {
                            if (item.videos && Array.isArray(item.videos)) {
                                finalVideos.push(...item.videos);
                            } else if (item.video_id) {
                                finalVideos.push(item);
                            }
                        });
                    }

                    if (finalVideos.length > 0) {
                        success = true;
                        // Save research results for this successful run
                        await this.supabase
                            .from('research_results')
                            .insert({
                                execution_id: executionId,
                                trendy_job_id: researchJob.jobId,
                                videos: finalVideos,
                                total_videos: finalVideos.length
                            });

                        await this.logToExecution(executionId, `Found ${finalVideos.length} videos from ${currentTargetHandles.join(',') || currentTargetIds.join(',')}`);
                    } else {
                        await this.logToExecution(executionId, `No videos found for this target. Retrying...`);
                    }

                } catch (err) {
                    console.error(`[Cron] Attempt ${attempts} failed:`, err);
                    await this.logToExecution(executionId, `Attempt ${attempts} error: ${err.message}`);
                }
            } // End while loop

            if (finalVideos.length === 0) {
                throw new Error('No videos found matching the algorithm criteria after retries.');
            }

            // Filter out previously used videos for this profile
            const profileId = job.channel_profiles?.id;
            if (profileId) {
                const usedVideoIds = await this.getUsedVideoIds(profileId);
                const originalCount = finalVideos.length;
                finalVideos = finalVideos.filter(v => !usedVideoIds.has(v.video_id));
                if (finalVideos.length < originalCount) {
                    await this.logToExecution(executionId, `Filtered ${originalCount - finalVideos.length} previously used videos`);
                }
                if (finalVideos.length === 0) {
                    throw new Error('All videos have been used before. No new content available.');
                }
            }

            // Step 2: Select video based on algorithm with transcript retry
            await this.updateExecution(executionId, 'generating_script', 'Selecting video via algorithm...');

            // Outer loop to handle transcript failures
            const maxVideoAttempts = 3;
            let videoAttempt = 0;
            let selectedVideo = null;
            let transcriptData = null;
            let transcriptSuccess = false;

            while (videoAttempt < maxVideoAttempts && !transcriptSuccess && finalVideos.length > 0) {
                videoAttempt++;
                selectedVideo = this.selectVideoByAlgorithm(finalVideos, job.algorithm_type, algorithmConfig);
                await this.logToExecution(executionId, `Selected video (attempt ${videoAttempt}): ${selectedVideo?.title || 'Unknown'}`);

                // Try to get transcript with 2 retries
                const maxTranscriptRetries = 2;
                for (let transcriptRetry = 1; transcriptRetry <= maxTranscriptRetries; transcriptRetry++) {
                    try {
                        await this.logToExecution(executionId, `Fetching transcript (retry ${transcriptRetry}/${maxTranscriptRetries})...`);
                        transcriptData = await scripzService.getTranscript(selectedVideo.video_id);
                        transcriptSuccess = true;
                        break;
                    } catch (transcriptErr) {
                        console.error(`[Cron] Transcript fetch failed (attempt ${transcriptRetry}):`, transcriptErr.message);
                        await this.logToExecution(executionId, `Transcript retry ${transcriptRetry} failed: ${transcriptErr.message}`);
                        if (transcriptRetry === maxTranscriptRetries) {
                            // Remove this video from candidates and try another
                            await this.logToExecution(executionId, `Transcript unavailable for ${selectedVideo.video_id}, selecting new video...`);
                            finalVideos = finalVideos.filter(v => v.video_id !== selectedVideo.video_id);
                        } else {
                            // Wait a bit before retry
                            await new Promise(r => setTimeout(r, 2000));
                        }
                    }
                }
            }

            if (!transcriptSuccess || !selectedVideo) {
                throw new Error('Failed to get transcript after multiple video attempts.');
            }

            // Update execution with source video
            await this.supabase
                .from('cron_job_executions')
                .update({ source_video: selectedVideo })
                .eq('id', executionId);

            // Step 3: Generate script based on script_mode
            let script;
            const scriptMode = job.script_mode || 'w4w';

            if (scriptMode === 'w4w') {
                // Word-for-word mode: extract script directly from source video
                await this.logToExecution(executionId, 'Using Word-for-Word mode (AI Enhanced)...');

                try {
                    // Note: transcriptData already fetched in video selection loop above

                    // Step 2: Analyze with OpenAI (Hook + Script + Gender)
                    await this.logToExecution(executionId, 'Analyzing story with OpenAI...');

                    // We need OpenAI API Key - try user settings first, then maybe a global fallback if you have one
                    const openaiApiKey = userSettings?.openai_api_key;
                    if (!openaiApiKey) {
                        throw new Error('OpenAI API key is required for W4W AI analysis. Please configure it in settings.');
                    }

                    const analysis = await openaiService.analyzeStory(transcriptData.full_text, openaiApiKey);

                    script = {
                        hook: analysis.hook,
                        script: analysis.script
                    };

                    console.log('[DEBUG] OpenAI Analysis:', JSON.stringify(analysis, null, 2));
                    await this.logToExecution(executionId, `Analysis complete. Gender: ${analysis.gender}`);

                    // Step 3: Handle Voice Selection based on Gender
                    // We need the profile to see presets
                    const profile = job.channel_profiles;
                    let selectedVoiceId = null;

                    if (profile) {
                        if (analysis.gender === 'female' && profile.female_voice_preset_id) {
                            // TODO: We need to fetch the actual voice_id from the preset
                            // For now, let's assume we need to query the voice_presets table or if it's already joined?
                            // The current query only joins channel_profiles. 
                            // We might need to fetch the preset details now.
                            const { data: voicePreset } = await this.supabase
                                .from('voice_presets')
                                .select('voice_id')
                                .eq('id', profile.female_voice_preset_id)
                                .single();

                            if (voicePreset) {
                                selectedVoiceId = voicePreset.voice_id;
                                await this.logToExecution(executionId, `Selected Female Voice Preset: ${selectedVoiceId}`);
                            }

                        } else if (analysis.gender === 'male' && profile.male_voice_preset_id) {
                            const { data: voicePreset } = await this.supabase
                                .from('voice_presets')
                                .select('voice_id')
                                .eq('id', profile.male_voice_preset_id)
                                .single();

                            if (voicePreset) {
                                selectedVoiceId = voicePreset.voice_id;
                                await this.logToExecution(executionId, `Selected Male Voice Preset: ${selectedVoiceId}`);
                            }
                        }
                    }

                    // If we found a specific voice for the gender, override the default profile voice
                    if (selectedVoiceId) {
                        // We will pass this to the triggerVideoGeneration or update the job temporarily?
                        // Better to pass it as an override to triggerVideoGeneration
                        job.override_voice_id = selectedVoiceId;
                    }

                    // Store detected gender for triggerVideoGeneration
                    job.detected_gender = analysis.gender;

                } catch (err) {
                    console.error('[Cron] W4W Enhancement Failed, falling back to basic:', err);
                    await this.logToExecution(executionId, `W4W AI failed (${err.message}). Falling back to description.`);

                    // Fallback to original logic
                    const sourceTitle = selectedVideo.title || '';
                    const sourceDescription = selectedVideo.description || '';
                    script = {
                        hook: sourceTitle,
                        script: sourceDescription.substring(0, 500) || sourceTitle
                    };
                }
            } else {
                // Claude remake mode: use AI to rewrite
                await this.logToExecution(executionId, 'Generating script with Claude...');

                const claudeApiKey = userSettings?.claude_api_key;
                if (!claudeApiKey) {
                    throw new Error('Claude API key not configured. Please add it in Settings.');
                }

                const customPrompt = job.claude_prompt || claudeService.getPromptForAlgorithm(job.algorithm_type);
                script = await claudeService.generateScript(selectedVideo, customPrompt, claudeApiKey);

                await this.logToExecution(executionId, `Generated hook: "${script.hook.substring(0, 50)}..."`);
            }

            await this.supabase
                .from('cron_job_executions')
                .update({
                    generated_hook: script.hook,
                    generated_script: script.script
                })
                .eq('id', executionId);

            // Step 4: Trigger video generation
            await this.updateExecution(executionId, 'rendering', 'Starting video render...');

            const videoResult = await this.triggerVideoGeneration(job, script, userSettings);
            await this.logToExecution(executionId, `Video generated: ${videoResult.videoUrl}`);

            // Build metadata for tracking
            const profile = job.channel_profiles;
            const metadata = {
                method: 'cron',
                algorithm_type: job.algorithm_type || 'random',
                source_video: selectedVideo ? {
                    video_id: selectedVideo.video_id,
                    channel: selectedVideo.channel_name,
                    title: selectedVideo.title?.substring(0, 100),
                    views: selectedVideo.view_count
                } : null,
                profile: {
                    id: profile?.id,
                    name: profile?.name
                },
                presets: {
                    caption: videoResult.metadata?.captionPreset || null,
                    hook_style: videoResult.metadata?.hookStylePreset || null,
                    audio: videoResult.metadata?.audioPreset || null
                },
                settings: {
                    voice_id: videoResult.metadata?.voiceId,
                    font: videoResult.metadata?.font,
                    subtitle_size: videoResult.metadata?.subtitle_size,
                    target_duration: videoResult.metadata?.targetDuration,
                    add_background_music: videoResult.metadata?.addBackgroundMusic
                },
                detected_gender: job.detected_gender || 'male',
                generated_at: new Date().toISOString()
            };

            // Step 5: Complete execution
            const { error: updateError } = await this.supabase
                .from('cron_job_executions')
                .update({
                    status: 'success',
                    completed_at: new Date().toISOString(),
                    videos_generated: 1,
                    video_url: videoResult.videoUrl,
                    video_id: videoResult.videoId,
                    metadata: metadata
                })
                .eq('id', executionId);

            if (updateError) {
                console.error('[Cron] Error updating execution status to success:', updateError);
            } else {
                console.log(`[Cron] Execution ${executionId} marked as SUCCESS`);
            }

            await this.logToExecution(executionId, 'Job completed successfully');

            // Log used video to prevent duplicates
            if (profileId && selectedVideo?.video_id) {
                await this.logUsedVideo(profileId, selectedVideo);
            }

            // Update job last_run
            await this.supabase
                .from('cron_jobs')
                .update({ last_run: new Date().toISOString() })
                .eq('id', jobId);

            // Send success notification
            if (job.telegram_notifications && userSettings?.telegram_user_id) {
                await this.sendTelegramNotification(userSettings.telegram_user_id, job, script, videoResult, null, selectedVideo);
            }

            return { success: true, executionId, videoUrl: videoResult.videoUrl };

        } catch (error) {
            console.error(`[Cron] Job execution failed for ${jobId}:`, error);

            // Update execution with error
            const { error: failUpdateError } = await this.supabase
                .from('cron_job_executions')
                .update({
                    status: 'failed',
                    completed_at: new Date().toISOString(),
                    error_message: error.message
                })
                .eq('id', executionId);

            if (failUpdateError) {
                console.error('[Cron] Error updating execution status to failed:', failUpdateError);
            } else {
                console.log(`[Cron] Execution ${executionId} marked as FAILED`);
            }

            await this.logToExecution(executionId, `Error: ${error.message}`);

            // Send error notification
            if (job.telegram_notifications && userSettings?.telegram_user_id) {
                await this.sendTelegramNotification(userSettings.telegram_user_id, job, null, null, error.message, null);
            }

            throw error;
        }
    }

    /**
     * Select a video based on algorithm type
     * @param {Array} videos - Array of videos from research
     * @param {string} algorithmType - Algorithm type
     * @param {Object} config - Algorithm configuration
     * @returns {Object} Selected video
     */
    selectVideoByAlgorithm(videos, algorithmType, config) {
        if (!videos || videos.length === 0) {
            throw new Error('No videos to select from');
        }

        switch (algorithmType) {
            case 'random':
                // Random selection from qualifying videos
                const randomIndex = Math.floor(Math.random() * videos.length);
                return videos[randomIndex];

            case 'top_videos':
                // Sort by views and pick the top one
                const sortedByViews = [...videos].sort((a, b) =>
                    (parseInt(b.latest_view_count || '0', 10)) - (parseInt(a.latest_view_count || '0', 10))
                );
                return sortedByViews[0];

            default:
                // Default to random
                return videos[Math.floor(Math.random() * videos.length)];
        }
    }

    /**
     * Get set of video IDs that have been used for a profile
     * @param {string} profileId - Channel profile ID
     * @returns {Promise<Set<string>>} Set of used video IDs
     */
    async getUsedVideoIds(profileId) {
        if (!this.supabase) return new Set();

        try {
            const { data, error } = await this.supabase
                .from('used_videos')
                .select('video_id')
                .eq('channel_profile_id', profileId);

            if (error) {
                console.error('[Cron] Error fetching used videos:', error);
                return new Set();
            }

            return new Set((data || []).map(v => v.video_id));
        } catch (err) {
            console.error('[Cron] Error in getUsedVideoIds:', err);
            return new Set();
        }
    }

    /**
     * Log a video as used for a profile
     * @param {string} profileId - Channel profile ID
     * @param {Object} video - Video object with video_id and title
     */
    async logUsedVideo(profileId, video) {
        if (!this.supabase || !profileId || !video?.video_id) return;

        try {
            const { error } = await this.supabase
                .from('used_videos')
                .upsert({
                    channel_profile_id: profileId,
                    video_id: video.video_id,
                    video_url: `https://www.youtube.com/watch?v=${video.video_id}`,
                    title: video.title || 'Unknown'
                }, {
                    onConflict: 'channel_profile_id,video_id'
                });

            if (error) {
                console.error('[Cron] Error logging used video:', error);
            } else {
                console.log(`[Cron] Logged used video: ${video.video_id} for profile ${profileId}`);
            }
        } catch (err) {
            console.error('[Cron] Error in logUsedVideo:', err);
        }
    }

    /**
     * Trigger video generation via internal API call
     * @param {Object} job - Cron job configuration
     * @param {Object} script - Generated hook and script
     * @param {Object} userSettings - User settings with API keys
     * @returns {Promise<Object>} Video generation result
     */
    async triggerVideoGeneration(job, script, userSettings) {
        // Build video generation payload using channel profile settings
        const profile = job.channel_profiles;

        if (!profile) {
            throw new Error('No channel profile associated with this job');
        }

        // Debug: Log profile preset IDs
        console.log('[Cron] Profile preset IDs:', {
            caption_preset_id: profile.caption_preset_id,
            hook_style_preset_id: profile.hook_style_preset_id,
            male_voice_preset_id: profile.male_voice_preset_id,
            female_voice_preset_id: profile.female_voice_preset_id,
            voice_id: profile.voice_id
        });

        // Fetch caption preset if configured (from 'presets' table)
        let captionPreset = null;
        if (profile.caption_preset_id) {
            const { data: preset, error } = await this.supabase
                .from('presets')
                .select('*')
                .eq('id', profile.caption_preset_id)
                .single();
            if (error) {
                console.error('[Cron] Error fetching caption preset:', error);
            }
            if (preset) {
                // Extract caption style from JSONB column or top-level fields
                const style = preset.caption_style || preset;
                captionPreset = {
                    font: style.font || preset.font,
                    style: style.style || preset.style,
                    subtitle_size: style.subtitle_size || preset.subtitle_size,
                    stroke_size: style.stroke_size || preset.stroke_size,
                    color: style.color || preset.color,
                    rainbow_text: style.rainbow_text || preset.rainbow_text || false,
                    caption_animation_type: style.caption_animation_type || 'scale',
                    look: captionLookFromStyle(style)
                };
                console.log('[Cron] Loaded caption preset:', preset.name, captionPreset);
            }
        }

        // Fetch hook style preset if configured (from 'presets' table)
        let hookStylePreset = null;
        if (profile.hook_style_preset_id) {
            const { data: preset, error } = await this.supabase
                .from('presets')
                .select('*')
                .eq('id', profile.hook_style_preset_id)
                .single();
            if (error) {
                console.error('[Cron] Error fetching hook style preset:', error);
            }
            if (preset) {
                // Extract hook style from JSONB column or top-level fields
                const style = preset.hook_style || preset;
                hookStylePreset = {
                    // keep the newer options (animation, scale, accent, menu dots, line height, top position)
                    ...style,
                    titleColor: style.titleColor || style.title_color || '#ffffff',
                    backgroundColor: style.backgroundColor || style.background_color || '#000000',
                    font: style.font || preset.font || 'Montserrat',
                    borderRadius: style.borderRadius || style.border_radius || 14
                };
                console.log('[Cron] Loaded hook style preset:', preset.name, hookStylePreset);
            }
        }

        // Fetch visual filter preset if configured (from 'presets' table)
        let visualFilterPreset = null;
        if (profile.visual_filter_preset_id) {
            const { data: preset, error } = await this.supabase
                .from('presets')
                .select('*')
                .eq('id', profile.visual_filter_preset_id)
                .single();
            if (error) {
                console.error('[Cron] Error fetching visual filter preset:', error);
            }
            if (preset) {
                // Extract visual filter from the preset
                visualFilterPreset = {
                    filterType: preset.visual_filter || 'none'
                };
                console.log('[Cron] Loaded visual filter preset:', preset.name, visualFilterPreset);
            }
        }

        // Fetch voice/audio preset based on detected gender (includes Slicr settings, music, target duration)
        let voiceId = job.override_voice_id || profile.voice_id;
        let audioPreset = null;

        // Determine which voice preset to use based on script gender
        const voicePresetId = job.detected_gender === 'female'
            ? profile.female_voice_preset_id
            : profile.male_voice_preset_id;

        if (voicePresetId) {
            const { data: preset, error } = await this.supabase
                .from('presets')
                .select('*')
                .eq('id', voicePresetId)
                .single();
            if (error) {
                console.error('[Cron] Error fetching audio preset:', error);
            }
            if (preset) {
                // Get voice ID from preset if not already set
                if (!voiceId) {
                    voiceId = preset.voice_id;
                }

                // Map to camelCase structure matching frontend expectations
                audioPreset = {
                    id: preset.id,
                    name: preset.name,
                    ttsProvider: preset.tts_provider || 'elevenlabs',
                    voiceId: preset.voice_id,
                    fishAudioModelId: preset.fish_audio_model_id || null,
                    fishAudioModelName: preset.fish_audio_model_name || null,
                    thresholdDb: preset.threshold_db || -40,
                    minDuration: preset.min_duration || 0.2,
                    targetDuration: preset.target_duration || null, // Combined hook+body target
                    leftPadding: preset.left_padding || 0.05,
                    rightPadding: preset.right_padding || 0.05,
                    addBackgroundMusic: preset.add_background_music || false,
                    musicVolumeDb: preset.music_volume_db || -13,
                    customMusicUrl: preset.custom_music_url || null
                };
                console.log(`[Cron] Loaded ${job.detected_gender || 'male'} audio preset:`, preset.name, audioPreset);
            }
        }

        const payload = {
            userId: job.user_id,
            profileId: profile.id,
            hook: script.hook,
            script: script.script,
            channelName: profile.name,
            channelImageUrl: profile.image_url,
            // Voice
            channelVoiceId: voiceId,
            // Presets
            captionPreset: captionPreset,
            hookStylePreset: hookStylePreset,
            visualFilterPreset: visualFilterPreset,
            audioPreset: audioPreset, // Includes Slicr settings, music, target duration
            // Styling from preset or profile
            channelFont: captionPreset?.font || profile.font || 'Luckiest Guy',
            channelStyle: captionPreset?.style || 'uppercase',
            subtitle_size: captionPreset?.subtitle_size || 50,
            stroke_size: captionPreset?.stroke_size || 8,
            // Background and hook animation
            background_video_type: profile.background_video_type || 'cooking',
            hook_animation_type: profile.hook_animation_type || 'fall',
            // API keys from user settings
            elevenlabsApiKey: userSettings?.elevenlabs_api_key,
            fishAudioApiKey: userSettings?.fish_audio_api_key,
            openaiApiKey: userSettings?.openai_api_key,
        };

        console.log('[Cron] Triggering video generation with payload:', {
            ...payload,
            elevenlabsApiKey: payload.elevenlabsApiKey ? '***' : undefined,
            openaiApiKey: payload.openaiApiKey ? '***' : undefined,
            captionPreset: captionPreset?.font ? `${captionPreset.font}/${captionPreset.subtitle_size}px` : 'none',
            hookStylePreset: hookStylePreset?.font || 'none',
            visualFilterPreset: visualFilterPreset?.filterType || 'none',
            audioPreset: audioPreset ? `${audioPreset.name} (target: ${audioPreset.targetDuration}s, music: ${audioPreset.addBackgroundMusic})` : 'none'
        });

        // Call the new video render service
        console.log('[Cron] Triggering video generation service...');

        try {
            const videoResult = await generateVideo(payload, (status) => {
                console.log(`[Cron Render] ${status.status}: ${status.message || ''}`);
            });

            console.log('[Cron] Video generation success:', videoResult);
            return {
                success: true,
                videoId: videoResult.videoId,
                videoUrl: videoResult.videoUrl,
                metadata: {
                    captionPreset: captionPreset?.font ? `${captionPreset.font}/${captionPreset.subtitle_size}px` : null,
                    hookStylePreset: hookStylePreset?.font || null,
                    audioPreset: audioPreset?.name || null,
                    voiceId: voiceId,
                    font: captionPreset?.font || payload.channelFont,
                    subtitle_size: captionPreset?.subtitle_size || payload.subtitle_size,
                    targetDuration: audioPreset?.targetDuration || null,
                    addBackgroundMusic: audioPreset?.addBackgroundMusic || false
                }
            };
        } catch (error) {
            console.error('[Cron] Video generation failed:', error);
            throw error;
        }
    }

    /**
     * Send Telegram notification
     */
    async sendTelegramNotification(chatId, job, script, videoResult, errorMessage, sourceVideo) {
        try {
            if (errorMessage) {
                await telegramService.sendErrorNotification(chatId, job.name, errorMessage);
            } else {
                let sourceLink = 'N/A';
                if (sourceVideo && sourceVideo.video_id) {
                    sourceLink = `https://www.youtube.com/watch?v=${sourceVideo.video_id}`;
                }

                const message = `
✅ <b>Cron Job Completed</b>

📋 Job: ${job.name}
⏰ Time: ${new Date().toLocaleString()}
🎬 Hook: ${script?.hook?.substring(0, 100)}...
🔗 Video: ${videoResult?.videoUrl || 'N/A'}
📺 OG Link: ${sourceLink}
                `.trim();

                await telegramService.sendMessage(chatId, message);
            }
        } catch (error) {
            console.error('[Cron] Telegram notification failed:', error);
        }
    }

    /**
     * Update execution status
     */
    async updateExecution(executionId, status, message) {
        if (!this.supabase) return;

        await this.supabase
            .from('cron_job_executions')
            .update({ status })
            .eq('id', executionId);

        await this.logToExecution(executionId, message);
    }

    /**
     * Add log entry to execution
     */
    async logToExecution(executionId, message) {
        if (!this.supabase) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            message
        };

        console.log(`[Cron Execution ${executionId}] ${message}`);

        // Append to logs array
        const { data: execution } = await this.supabase
            .from('cron_job_executions')
            .select('logs')
            .eq('id', executionId)
            .single();

        const logs = execution?.logs || [];
        logs.push(logEntry);

        await this.supabase
            .from('cron_job_executions')
            .update({ logs })
            .eq('id', executionId);
    }

    /**
     * Calculate and update next run time
     */
    async updateNextRun(jobId, schedule) {
        if (!this.supabase) return;

        // Simple next run calculation - in production use cron-parser
        const now = new Date();
        // Add 1 hour as a rough estimate
        const nextRun = new Date(now.getTime() + 60 * 60 * 1000);

        await this.supabase
            .from('cron_jobs')
            .update({ next_run: nextRun.toISOString() })
            .eq('id', jobId);
    }

    /**
     * Get all scheduled job IDs
     * @returns {Array} List of job IDs
     */
    getScheduledJobs() {
        return Array.from(this.scheduledJobs.keys());
    }

    /**
     * Refresh a job from database and reschedule
     */
    async refreshJob(jobId) {
        if (!this.supabase) return;

        const { data: job, error } = await this.supabase
            .from('cron_jobs')
            .select('*')
            .eq('id', jobId)
            .single();

        if (error || !job) {
            this.unscheduleJob(jobId);
            return;
        }

        if (job.enabled) {
            await this.scheduleJob(job);
        } else {
            this.unscheduleJob(jobId);
        }
    }
}

export const cronJobService = new CronJobService();
