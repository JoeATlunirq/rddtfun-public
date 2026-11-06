import { deploySite, deployFunction, getOrCreateBucket } from "@remotion/lambda";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, "../../.env") });

// Use separate Lambda credentials if available, otherwise fall back to default
if (process.env.REMOTION_AWS_ACCESS_KEY_ID) {
    process.env.AWS_ACCESS_KEY_ID = process.env.REMOTION_AWS_ACCESS_KEY_ID;
}
if (process.env.REMOTION_AWS_SECRET_ACCESS_KEY) {
    process.env.AWS_SECRET_ACCESS_KEY = process.env.REMOTION_AWS_SECRET_ACCESS_KEY;
}

const REGION = (process.env.AWS_REGION || "us-east-1") as "us-east-1";

async function deploy() {
    console.log("🚀 Starting Remotion Lambda deployment...\n");

    try {
        // 1. Create or get S3 bucket for renders
        console.log("📦 Setting up S3 bucket...");
        const { bucketName } = await getOrCreateBucket({ region: REGION });
        console.log(`   ✓ Bucket: ${bucketName}\n`);

        // 2. Deploy the Remotion site (bundled compositions)
        console.log("🌐 Deploying Remotion site...");
        const { serveUrl } = await deploySite({
            entryPoint: path.join(__dirname, "index.tsx"),
            bucketName,
            region: REGION,
            siteName: "rddtfun-video",
        });
        console.log(`   ✓ Serve URL: ${serveUrl}\n`);

        // 3. Deploy the Lambda function
        console.log("⚡ Deploying Lambda function...");
        const { functionName } = await deployFunction({
            region: REGION,
            timeoutInSeconds: 240,
            memorySizeInMb: 2048,
            diskSizeInMb: 2048,
            createCloudWatchLogGroup: true,
        });
        console.log(`   ✓ Function: ${functionName}\n`);

        // 4. Output environment variables to add
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("✅ Deployment complete! Add these to your .env file:\n");
        console.log(`REMOTION_AWS_BUCKET_NAME=${bucketName}`);
        console.log(`REMOTION_SERVE_URL=${serveUrl}`);
        console.log(`REMOTION_FUNCTION_NAME=${functionName}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        return { bucketName, serveUrl, functionName };
    } catch (error) {
        console.error("❌ Deployment failed:", error);
        throw error;
    }
}

deploy();
