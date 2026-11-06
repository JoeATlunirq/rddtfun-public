import { renderMediaOnLambda, getRenderProgress } from "@remotion/lambda/client";

/**
 * Temporarily swap AWS credentials to use Remotion-specific credentials
 * Returns a restore function to revert to original credentials
 */
function useRemotionCredentials() {
    const originalAccessKey = process.env.AWS_ACCESS_KEY_ID;
    const originalSecretKey = process.env.AWS_SECRET_ACCESS_KEY;

    // Swap to Remotion credentials if available
    if (process.env.REMOTION_AWS_ACCESS_KEY_ID) {
        process.env.AWS_ACCESS_KEY_ID = process.env.REMOTION_AWS_ACCESS_KEY_ID;
    }
    if (process.env.REMOTION_AWS_SECRET_ACCESS_KEY) {
        process.env.AWS_SECRET_ACCESS_KEY = process.env.REMOTION_AWS_SECRET_ACCESS_KEY;
    }

    console.log('[Lambda] Using Remotion credentials for Lambda API call');

    // Return restore function
    return () => {
        process.env.AWS_ACCESS_KEY_ID = originalAccessKey;
        process.env.AWS_SECRET_ACCESS_KEY = originalSecretKey;
    };
}

/**
 * Check if Lambda rendering is available and enabled
 */
export function isLambdaEnabled() {
    const useLambda = process.env.USE_LAMBDA_RENDERING === 'true';
    const hasFunction = !!process.env.REMOTION_FUNCTION_NAME;
    const hasServeUrl = !!process.env.REMOTION_SERVE_URL;
    const enabled = useLambda && hasFunction && hasServeUrl;

    console.log(`[Lambda] isLambdaEnabled check: USE_LAMBDA=${useLambda}, FUNCTION=${hasFunction}, SERVE_URL=${hasServeUrl} => ${enabled}`);
    return enabled;
}

/**
 * Start a video render on AWS Lambda
 */
export async function renderVideoOnLambda(inputProps, videoId) {
    const FUNCTION_NAME = process.env.REMOTION_FUNCTION_NAME;
    const SERVE_URL = process.env.REMOTION_SERVE_URL;
    const REGION = process.env.AWS_REGION || "us-east-1";

    if (!FUNCTION_NAME || !SERVE_URL) {
        throw new Error("Missing Lambda configuration");
    }

    console.log("[Lambda] Starting render...");

    // Swap to Remotion credentials
    const restoreCredentials = useRemotionCredentials();

    try {
        // Dynamic calculation to stay within the account concurrency limit
        const totalFrames = inputProps.totalDurationInFrames || 1800; // Default to 1min @ 30fps if missing
        const targetFunctions = Math.max(1, Number(process.env.REMOTION_MAX_FUNCTIONS) || 100);
        const dynamicFramesPerLambda = Math.max(20, Math.ceil(totalFrames / targetFunctions));

        console.log(`[Lambda] Dynamic framesPerLambda: ${dynamicFramesPerLambda} for ${totalFrames} frames`);

        const { renderId, bucketName } = await renderMediaOnLambda({
            region: REGION,
            functionName: FUNCTION_NAME,
            serveUrl: SERVE_URL,
            composition: "MainComposition",
            inputProps,
            codec: "h264",
            imageFormat: "png",
            maxRetries: 3,
            privacy: "public",
            outName: `${videoId || Date.now()}.mp4`,
            framesPerLambda: dynamicFramesPerLambda,
            timeoutInMilliseconds: 120000, // Increase from default 30s to 120s for heavy S3 assets
        });

        console.log(`[Lambda] Render started: ${renderId}`);
        return { renderId, bucketName };
    } finally {
        restoreCredentials();
    }
}

/**
 * Check the progress of a Lambda render
 */
export async function checkRenderProgress(renderId, bucketName = null) {
    const FUNCTION_NAME = process.env.REMOTION_FUNCTION_NAME;
    const REGION = process.env.AWS_REGION || "us-east-1";
    const BUCKET_NAME = bucketName || process.env.REMOTION_AWS_BUCKET_NAME;

    if (!FUNCTION_NAME) {
        throw new Error("Missing REMOTION_FUNCTION_NAME");
    }

    // Swap to Remotion credentials
    const restoreCredentials = useRemotionCredentials();

    try {
        const progress = await getRenderProgress({
            renderId,
            bucketName: BUCKET_NAME,
            region: REGION,
            functionName: FUNCTION_NAME,
        });

        return {
            done: progress.done,
            progress: progress.overallProgress,
            outputUrl: progress.outputFile,
            errors: progress.errors || [],
            fatalErrorEncountered: progress.fatalErrorEncountered,
        };
    } finally {
        restoreCredentials();
    }
}

/**
 * Wait for a render to complete (blocking)
 */
export async function waitForRenderCompletion(renderId, bucketName = null, onProgress = null, pollIntervalMs = 5000) {
    const BUCKET_NAME = bucketName || process.env.REMOTION_AWS_BUCKET_NAME;
    console.log(`[Lambda] Waiting for render ${renderId} to complete...`);

    let consecutiveErrors = 0;
    const maxErrors = 10;

    while (true) {
        try {
            const status = await checkRenderProgress(renderId, BUCKET_NAME);
            consecutiveErrors = 0; // Reset on success

            if (status.fatalErrorEncountered) {
                const errorDetails = status.errors.map(e =>
                    typeof e === 'object' ? JSON.stringify(e) : e
                ).join(", ");
                console.error(`[Lambda] Render failed with errors:`, status.errors);
                const fatalError = new Error(`Render failed: ${errorDetails}`);
                fatalError.isFatalRenderError = true;
                throw fatalError;
            }

            if (status.done) {
                console.log(`[Lambda] Render complete: ${status.outputUrl}`);
                return status.outputUrl;
            }

            const progressPct = Math.round(status.progress * 100);
            console.log(`[Lambda] Progress: ${progressPct}%`);

            if (onProgress) {
                onProgress(progressPct);
            }
        } catch (error) {
            if (error.isFatalRenderError) throw error;

            // Handle rate limiting with exponential backoff
            if (error.name === 'TooManyRequestsException' || error.message?.includes('Rate Exceeded')) {
                consecutiveErrors++;
                if (consecutiveErrors >= maxErrors) {
                    throw new Error(`Too many rate limit errors (${consecutiveErrors})`);
                }
                const backoffMs = Math.min(pollIntervalMs * Math.pow(2, consecutiveErrors), 30000);
                console.log(`[Lambda] Rate limited, backing off for ${backoffMs / 1000}s (attempt ${consecutiveErrors}/${maxErrors})`);
                await new Promise(r => setTimeout(r, backoffMs));
                continue;
            }
            throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
}
