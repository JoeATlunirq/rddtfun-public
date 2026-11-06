import { Config } from '@remotion/cli/config';

// Increase delayRender timeout for heavy heavy assets (S3 videos)
// Default is 30000ms (30s). Increasing to 120s.
Config.setDelayRenderTimeoutInMilliseconds(120000);
