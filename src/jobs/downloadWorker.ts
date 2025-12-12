/**
 * Download Worker - Background job processor
 *
 * This is the "brain" that:
 * 1. Listens to the queue for new jobs
 * 2. Updates job status in jobStore
 * 3. Uploads files to S3
 * 4. Generates presigned URLs
 *
 * Connects: queue.ts + jobStore.ts + s3Service.ts
 */

import { s3Service } from "../services/s3Service.ts";
import { jobStore } from "../utils/jobStore.ts";
import { downloadQueue } from "./queue.ts";
import type { QueueJob } from "./queue.ts";

// Simulated processing time per file (1-3 seconds)
const MIN_PROCESS_TIME = 1000;
const MAX_PROCESS_TIME = 3000;

// Optimization: Process files in parallel batches
const PARALLEL_FILE_BATCH_SIZE = 3;

/**
 * Simulate file processing delay
 * In real world, this would be actual file generation/fetch
 */
function simulateProcessingDelay(): Promise<void> {
  const delay =
    Math.floor(Math.random() * (MAX_PROCESS_TIME - MIN_PROCESS_TIME)) +
    MIN_PROCESS_TIME;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Process a single file ID
 * Returns S3 key and file size
 */
async function processFile(
  fileId: number,
): Promise<{ s3Key: string; size: number }> {
  // Simulate processing time
  await simulateProcessingDelay();

  // Upload to S3 (or mock)
  const result = await s3Service.uploadFile(fileId);

  return result;
}

/**
 * Main job processor function
 * Called by the queue when a job is ready to process
 * OPTIMIZED: Uses parallel batch processing for files
 */
async function processDownloadJob(queueJob: QueueJob): Promise<void> {
  const { jobId, fileIds } = queueJob;
  console.log(`[Worker] Starting job: ${jobId}`);

  // Get job from store
  const job = jobStore.getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  // Update status to processing
  jobStore.updateJob(jobId, {
    status: "processing",
    progress: 0,
    processingStartedAt: new Date(),
  });

  const totalFiles = fileIds.length;
  const processedS3Keys: string[] = [];

  try {
    // OPTIMIZATION: Process files in parallel batches
    // Instead of processing one file at a time, process PARALLEL_FILE_BATCH_SIZE files concurrently
    let processedCount = 0;

    for (let i = 0; i < totalFiles; i += PARALLEL_FILE_BATCH_SIZE) {
      const batch = fileIds.slice(i, i + PARALLEL_FILE_BATCH_SIZE);
      
      console.log(
        `[Worker] Job ${jobId}: Processing batch of ${String(batch.length)} files (${String(i + 1)}-${String(Math.min(i + batch.length, totalFiles))}/${String(totalFiles)})`,
      );

      // Process batch in parallel using Promise.all
      const batchResults = await Promise.all(
        batch.map(async (fileId) => {
          const { s3Key } = await processFile(fileId);
          return s3Key;
        })
      );

      processedS3Keys.push(...batchResults);
      processedCount += batch.length;

      // Update progress after each batch
      const progress = Math.round((processedCount / totalFiles) * 100);
      jobStore.updateJob(jobId, { progress });

      console.log(`[Worker] Job ${jobId}: Progress ${String(progress)}%`);
    }

    // All files processed - generate final download URL
    // For simplicity, we use the last file's S3 key
    // In production, you might create a ZIP of all files
    const finalS3Key =
      processedS3Keys.length > 0
        ? processedS3Keys[processedS3Keys.length - 1]
        : `downloads/${jobId}.zip`;

    const downloadUrl = await s3Service.generatePresignedUrl(finalS3Key);

    // Mark job as ready
    jobStore.updateJob(jobId, {
      status: "ready",
      progress: 100,
      downloadUrl,
      completedAt: new Date(),
    });

    console.log(`[Worker] Job ${jobId} completed successfully`);
    console.log(`[Worker] Download URL: ${downloadUrl.substring(0, 50)}...`);
  } catch (error) {
    // Mark job as failed
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    jobStore.updateJob(jobId, {
      status: "failed",
      error: errorMessage,
      completedAt: new Date(),
    });

    console.error(`[Worker] Job ${jobId} failed:`, errorMessage);
    throw error; // Re-throw for queue retry logic
  }
}

/**
 * Initialize the worker
 * Sets up queue event listeners
 */
export function initializeWorker(): void {
  console.log("[Worker] Initializing download worker...");

  // Set up the queue processor
  downloadQueue.process(processDownloadJob);

  // Listen for queue events
  downloadQueue.on("job:completed", (job: QueueJob) => {
    console.log(`[Worker] Event: Job ${job.jobId} completed`);
  });

  downloadQueue.on("job:failed", (job: QueueJob) => {
    console.error(`[Worker] Event: Job ${job.jobId} failed`);
  });

  downloadQueue.on("job:retry", (job: QueueJob) => {
    console.log(
      `[Worker] Event: Retrying job ${job.jobId} (attempt ${String(job.attempts)})`,
    );
  });

  console.log("[Worker] Download worker initialized and listening for jobs");
}

/**
 * Add a new download job to the queue
 * This is called by the API routes
 */
export async function queueDownloadJob(
  jobId: string,
  fileIds: number[],
): Promise<void> {
  // Create job in store first
  jobStore.createJob({ jobId, fileIds });

  // Add to queue
  await downloadQueue.add(jobId, fileIds);

  console.log(
    `[Worker] Queued job ${jobId} with ${String(fileIds.length)} file(s)`,
  );
}

/**
 * Get queue statistics
 */
export function getQueueStats(): {
  queueSize: number;
  activeJobs: number;
  jobStats: ReturnType<typeof jobStore.getStats>;
} {
  return {
    queueSize: downloadQueue.size(),
    activeJobs: downloadQueue.getActiveCount(),
    jobStats: jobStore.getStats(),
  };
}

/**
 * Graceful shutdown
 */
export async function shutdownWorker(): Promise<void> {
  console.log("[Worker] Shutting down worker...");
  await downloadQueue.shutdown();
  s3Service.destroy();
  console.log("[Worker] Worker shutdown complete");
}

// Export for testing
export { processDownloadJob, processFile };
