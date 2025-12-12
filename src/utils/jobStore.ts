/**
 * Job Store - In-memory storage for download job tracking
 *
 * This module provides a simple in-memory store for tracking download jobs.
 * In production, this would be replaced with Redis or a database.
 *
 * Job lifecycle: queued → processing → ready/failed
 *
 * HYBRID PATTERN: Includes EventEmitter for real-time SSE updates
 */

import { EventEmitter } from "events";

// Job status enum
export type JobStatus = "queued" | "processing" | "ready" | "failed";

// Job interface
export interface Job {
  jobId: string;
  fileIds: number[];
  status: JobStatus;
  progress: number; // 0-100
  downloadUrl?: string; // Presigned S3 URL when ready
  s3Key?: string; // S3 object key
  error?: string; // Error message if failed
  createdAt: Date;
  updatedAt: Date;
  processingStartedAt?: Date;
  completedAt?: Date;
}

// Job creation input
export interface CreateJobInput {
  jobId: string;
  fileIds: number[];
}

// Job update input
export interface UpdateJobInput {
  status?: JobStatus;
  progress?: number;
  downloadUrl?: string;
  s3Key?: string;
  error?: string;
  processingStartedAt?: Date;
  completedAt?: Date;
}

/**
 * In-memory job store
 * Uses a Map for O(1) lookups by jobId
 * EventEmitter for real-time SSE updates (Hybrid Pattern)
 */
class JobStore extends EventEmitter {
  private jobs = new Map<string, Job>();

  constructor() {
    super();
    // Allow many listeners for SSE connections
    this.setMaxListeners(1000);
  }

  /**
   * Create a new job
   */
  createJob(input: CreateJobInput): Job {
    const now = new Date();
    const job: Job = {
      jobId: input.jobId,
      fileIds: input.fileIds,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(input.jobId, job);
    console.log(
      `[JobStore] Created job ${input.jobId} with ${String(input.fileIds.length)} files`,
    );

    // Emit event for SSE subscribers
    this.emit(`job:${input.jobId}`, { type: "created", job });
    this.emit("job:created", job);

    return job;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Update a job
   */
  updateJob(jobId: string, updates: UpdateJobInput): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) {
      console.warn(`[JobStore] Attempted to update non-existent job ${jobId}`);
      return undefined;
    }

    // Apply updates
    const updatedJob: Job = {
      ...job,
      ...updates,
      updatedAt: new Date(),
    };

    this.jobs.set(jobId, updatedJob);
    console.log(
      `[JobStore] Updated job ${jobId}: status=${updatedJob.status}, progress=${String(updatedJob.progress)}%`,
    );

    // Emit event for SSE subscribers (Hybrid Pattern)
    this.emit(`job:${jobId}`, { type: "updated", job: updatedJob });

    // Emit completion events
    if (updatedJob.status === "ready") {
      this.emit(`job:${jobId}`, { type: "completed", job: updatedJob });
      this.emit("job:completed", updatedJob);
    } else if (updatedJob.status === "failed") {
      this.emit(`job:${jobId}`, { type: "failed", job: updatedJob });
      this.emit("job:failed", updatedJob);
    }

    return updatedJob;
  }

  /**
   * Delete a job
   */
  deleteJob(jobId: string): boolean {
    const deleted = this.jobs.delete(jobId);
    if (deleted) {
      console.log(`[JobStore] Deleted job ${jobId}`);
    }
    return deleted;
  }

  /**
   * Get all jobs
   */
  getAllJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: JobStatus): Job[] {
    return Array.from(this.jobs.values()).filter(
      (job) => job.status === status,
    );
  }

  /**
   * Get queued jobs (for worker to process)
   */
  getQueuedJobs(): Job[] {
    return this.getJobsByStatus("queued");
  }

  /**
   * Get job count
   */
  getJobCount(): number {
    return this.jobs.size;
  }

  /**
   * Get job statistics
   */
  getStats(): {
    total: number;
    queued: number;
    processing: number;
    ready: number;
    failed: number;
  } {
    const jobs = this.getAllJobs();
    const stats = {
      total: jobs.length,
      queued: jobs.filter((j) => j.status === "queued").length,
      processing: jobs.filter((j) => j.status === "processing").length,
      ready: jobs.filter((j) => j.status === "ready").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    };
    return stats;
  }

  /**
   * Clear all jobs (useful for testing)
   */
  clear(): void {
    this.jobs.clear();
    console.log("[JobStore] Cleared all jobs");
  }

  /**
   * Clean up old completed/failed jobs (older than maxAge)
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if (
        (job.status === "ready" || job.status === "failed") &&
        now - job.updatedAt.getTime() > maxAgeMs
      ) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[JobStore] Cleaned up ${String(cleaned)} old jobs`);
    }
    return cleaned;
  }
}

// Export singleton instance
export const jobStore = new JobStore();

// Export class for testing
export { JobStore };
