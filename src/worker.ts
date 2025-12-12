/**
 * Worker Process - Background Job Processor
 *
 * This worker handles long-running download jobs asynchronously
 * using BullMQ (Redis-based job queue).
 *
 * Architecture:
 * - API receives download request → creates job in Redis queue
 * - Worker picks up job → processes download → uploads to S3
 * - Client polls for status or receives webhook callback
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

// Environment schema for worker
const WorkerEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z
    .string()
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  S3_BUCKET_NAME: z.string().default("downloads"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  REDIS_HOST: z.string().default("redis"),
  REDIS_PORT: z.coerce.number().int().default(6379),
  // Download delay simulation (inherited from main app)
  DOWNLOAD_DELAY_MIN_MS: z.coerce.number().int().min(0).default(10000),
  DOWNLOAD_DELAY_MAX_MS: z.coerce.number().int().min(0).default(200000),
  DOWNLOAD_DELAY_ENABLED: z.coerce.boolean().default(true),
});

// Parse environment
const env = WorkerEnvSchema.parse(process.env);

// S3 Client for worker
const s3Client = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
  ...(env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY && {
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    }),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

// Job types
interface DownloadJob {
  jobId: string;
  fileIds: number[];
  createdAt: string;
}

// Helper functions
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const getRandomDelay = (): number => {
  if (!env.DOWNLOAD_DELAY_ENABLED) return 0;
  const min = env.DOWNLOAD_DELAY_MIN_MS;
  const max = env.DOWNLOAD_DELAY_MAX_MS;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const sanitizeS3Key = (fileId: number): string => {
  const sanitizedId = Math.floor(Math.abs(fileId));
  return `downloads/${String(sanitizedId)}.zip`;
};

// Simulated file generation
const generateFileContent = (fileId: number): Buffer => {
  const content = JSON.stringify({
    fileId,
    generatedAt: new Date().toISOString(),
    data: `Simulated file content for file ID ${String(fileId)}`,
    randomBytes: crypto.randomUUID(),
  });
  return Buffer.from(content);
};

// Process a single file download
const processFileDownload = async (fileId: number): Promise<void> => {
  const s3Key = sanitizeS3Key(fileId);
  const startTime = Date.now();

  // Simulate processing delay
  const delayMs = getRandomDelay();
  console.log(
    `[Worker] Processing file_id=${String(fileId)} | delay=${(delayMs / 1000).toFixed(1)}s`,
  );
  await sleep(delayMs);

  // Generate file content
  const content = generateFileContent(fileId);

  // Upload to S3
  try {
    const command = new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: content,
      ContentType: "application/zip",
    });
    await s3Client.send(command);

    const processingTime = Date.now() - startTime;
    console.log(
      `[Worker] Completed file_id=${String(fileId)} | s3Key=${s3Key} | time=${String(processingTime)}ms`,
    );
  } catch (error) {
    console.error(
      `[Worker] Failed to upload file_id=${String(fileId)}:`,
      error,
    );
    throw error;
  }
};

// Process a job (batch of file downloads)
const processJob = async (job: DownloadJob): Promise<void> => {
  console.log(
    `[Worker] Starting job ${job.jobId} with ${String(job.fileIds.length)} files`,
  );

  for (const fileId of job.fileIds) {
    await processFileDownload(fileId);
  }

  console.log(`[Worker] Job ${job.jobId} completed`);
};

// Main worker loop (simple polling implementation)
// In production, this would use BullMQ Worker with proper job handling
const startWorker = async (): Promise<void> => {
  console.log("=".repeat(50));
  console.log("[Worker] Starting Download Worker");
  console.log(`[Worker] Environment: ${env.NODE_ENV}`);
  console.log(`[Worker] Redis: ${env.REDIS_HOST}:${String(env.REDIS_PORT)}`);
  console.log(`[Worker] S3 Endpoint: ${env.S3_ENDPOINT ?? "AWS Default"}`);
  console.log(`[Worker] S3 Bucket: ${env.S3_BUCKET_NAME}`);
  console.log(
    `[Worker] Delay Range: ${String(env.DOWNLOAD_DELAY_MIN_MS / 1000)}s - ${String(env.DOWNLOAD_DELAY_MAX_MS / 1000)}s`,
  );
  console.log("=".repeat(50));

  // For hackathon demo: process sample jobs
  // In production: connect to Redis and listen for BullMQ jobs

  console.log("[Worker] Worker is ready and waiting for jobs...");
  console.log(
    "[Worker] NOTE: Implement BullMQ job processing for production use",
  );

  // Keep worker alive
  const keepAlive = (): void => {
    setTimeout(() => {
      console.log(
        `[Worker] Heartbeat - ${new Date().toISOString()} - Waiting for jobs...`,
      );
      keepAlive();
    }, 30000); // Log every 30 seconds
  };

  keepAlive();

  // Example: Process a demo job on startup (for testing)
  if (env.NODE_ENV === "development") {
    console.log("[Worker] Running demo job in development mode...");

    const demoJob: DownloadJob = {
      jobId: crypto.randomUUID(),
      fileIds: [10001, 20002, 30003], // Sample file IDs
      createdAt: new Date().toISOString(),
    };

    try {
      await processJob(demoJob);
      console.log("[Worker] Demo job completed successfully!");
    } catch (error: unknown) {
      console.error("[Worker] Demo job failed:", error);
    }
  }
};

// Graceful shutdown
const gracefulShutdown = (signal: string): void => {
  console.log(`\n[Worker] ${signal} received. Shutting down gracefully...`);

  // Destroy S3 client
  s3Client.destroy();
  console.log("[Worker] S3 client destroyed");
  console.log("[Worker] Worker shutdown complete");
};

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  gracefulShutdown("SIGINT");
});

// Start the worker
startWorker().catch((error: unknown) => {
  console.error("[Worker] Fatal error:", error);
  throw error;
});
