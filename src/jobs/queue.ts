/**
 * Simple In-Memory Job Queue
 *
 * A lightweight queue implementation for processing download jobs.
 * Uses EventEmitter pattern for async job processing.
 *
 * In production, this would be replaced with BullMQ + Redis for:
 * - Persistence across restarts
 * - Distributed workers
 * - Retry logic with backoff
 * - Priority queues
 */

import { EventEmitter } from "events";

// Job item in the queue
export interface QueueJob {
  jobId: string;
  fileIds: number[];
  addedAt: Date;
  attempts: number;
}

// Handler function type
export type JobHandler = (job: QueueJob) => Promise<void>;

/**
 * Simple FIFO queue with event-based processing
 */
class SimpleQueue extends EventEmitter {
  private queue: QueueJob[] = [];
  private processing: boolean = false;
  private handler: JobHandler | null = null;
  private concurrency: number = 1;
  private activeJobs: number = 0;
  private maxRetries: number = 3;
  private isRunning: boolean = false;

  constructor(options?: { concurrency?: number; maxRetries?: number }) {
    super();
    this.concurrency = options?.concurrency ?? 1;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  /**
   * Add a job to the queue
   */
  async add(jobId: string, fileIds: number[]): Promise<QueueJob> {
    const job: QueueJob = {
      jobId,
      fileIds,
      addedAt: new Date(),
      attempts: 0,
    };

    this.queue.push(job);
    console.log(
      `[Queue] Added job ${jobId} to queue. Queue size: ${String(this.queue.length)}`,
    );

    // Emit event for new job
    this.emit("job:added", job);

    // Try to process if we have capacity
    this.tryProcess();
    return await Promise.resolve(job);

    return job;
  }

  /**
   * Register a handler function for processing jobs
   */
  process(handler: JobHandler): void {
    this.handler = handler;
    this.isRunning = true;
    console.log("[Queue] Handler registered, queue is now processing");

    // Start processing any queued jobs
    this.tryProcess();
  }

  /**
   * Try to process jobs if we have capacity
   */
  private tryProcess(): void {
    if (!this.isRunning || !this.handler) {
      return;
    }

    // Process jobs up to concurrency limit
    while (this.activeJobs < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) {
        void this.processJob(job);
      }
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: QueueJob): Promise<void> {
    if (!this.handler) return;

    this.activeJobs++;
    job.attempts++;

    console.log(
      `[Queue] Processing job ${job.jobId} (attempt ${String(job.attempts)}/${String(this.maxRetries)})`,
    );
    this.emit("job:processing", job);

    try {
      await this.handler(job);
      console.log(`[Queue] Job ${job.jobId} completed successfully`);
      this.emit("job:completed", job);
    } catch (error) {
      console.error(`[Queue] Job ${job.jobId} failed:`, error);

      // Retry logic
      if (job.attempts < this.maxRetries) {
        console.log(`[Queue] Retrying job ${job.jobId}...`);
        this.queue.push(job); // Re-add to queue
        this.emit("job:retry", job, error);
      } else {
        console.error(
          `[Queue] Job ${job.jobId} failed after ${String(this.maxRetries)} attempts`,
        );
        this.emit("job:failed", job, error);
      }
    } finally {
      this.activeJobs--;
      // Try to process more jobs
      this.tryProcess();
    }
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Get number of active jobs being processed
   */
  getActiveCount(): number {
    return this.activeJobs;
  }

  /**
   * Check if queue is running
   */
  isQueueRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Pause the queue (stop processing new jobs)
   */
  pause(): void {
    this.isRunning = false;
    console.log("[Queue] Queue paused");
    this.emit("queue:paused");
  }

  /**
   * Resume the queue
   */
  resume(): void {
    this.isRunning = true;
    console.log("[Queue] Queue resumed");
    this.emit("queue:resumed");
    this.tryProcess();
  }

  /**
   * Stop the queue and clear all pending jobs
   */
  stop(): void {
    this.isRunning = false;
    const pendingJobs = this.queue.length;
    this.queue = [];
    console.log(
      `[Queue] Queue stopped. Cleared ${String(pendingJobs)} pending jobs`,
    );
    this.emit("queue:stopped");
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    active: number;
    concurrency: number;
    isRunning: boolean;
  } {
    return {
      pending: this.queue.length,
      active: this.activeJobs,
      concurrency: this.concurrency,
      isRunning: this.isRunning,
    };
  }

  /**
   * Graceful shutdown - wait for active jobs to complete
   */
  async shutdown(timeoutMs: number = 30000): Promise<void> {
    console.log("[Queue] Initiating graceful shutdown...");
    this.isRunning = false;

    // Wait for active jobs to complete
    const startTime = Date.now();
    while (this.activeJobs > 0) {
      if (Date.now() - startTime > timeoutMs) {
        console.warn(
          `[Queue] Shutdown timeout reached with ${String(this.activeJobs)} active jobs`,
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.queue = [];
    console.log("[Queue] Shutdown complete");
    this.emit("queue:shutdown");
  }
}

// Export singleton instance
// Optimized: Increased concurrency from 2 to 5 for better throughput
export const downloadQueue = new SimpleQueue({ concurrency: 5, maxRetries: 3 });

// Export class for testing or creating additional queues
export { SimpleQueue };
