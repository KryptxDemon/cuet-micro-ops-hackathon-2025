/**
 * Async Download Routes - HYBRID PATTERN
 *
 * Endpoints for the async download system:
 * - POST /v1/download/async   - Start async download job
 * - GET  /v1/download/status/:jobId - Poll job status (Polling Pattern)
 * - GET  /v1/download/subscribe/:jobId - Real-time updates (SSE Pattern)
 * - GET  /v1/download/queue/stats   - Queue statistics
 *
 * HYBRID APPROACH:
 * 1. Polling (Option A) - Simple HTTP polling for compatibility
 * 2. SSE (Option B) - Real-time server-sent events for modern clients
 * 3. Both work simultaneously - client chooses preferred method
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { queueDownloadJob, getQueueStats } from "../jobs/downloadWorker.ts";
import { jobStore } from "../utils/jobStore.ts";

// Create a new Hono app for async download routes
const asyncDownloadRoutes = new OpenAPIHono();

// ============== Schemas ==============

const AsyncDownloadRequestSchema = z
  .object({
    file_ids: z
      .array(z.number().int().min(10000).max(100000000))
      .min(1)
      .max(1000)
      .openapi({ description: "Array of file IDs to download (10K to 100M)" }),
  })
  .openapi("AsyncDownloadRequest");

const AsyncDownloadResponseSchema = z
  .object({
    jobId: z.uuid().openapi({ description: "Unique job identifier" }),
    status: z.enum(["queued"]).openapi({ description: "Initial job status" }),
    message: z.string().openapi({ description: "Status message" }),
    totalFiles: z
      .number()
      .int()
      .openapi({ description: "Number of files to process" }),
    statusUrl: z.string().openapi({ description: "URL to poll for status" }),
  })
  .openapi("AsyncDownloadResponse");

const JobStatusResponseSchema = z
  .object({
    jobId: z.string().openapi({ description: "Job identifier" }),
    status: z.enum(["queued", "processing", "ready", "failed"]).openapi({
      description: "Current job status",
    }),
    progress: z.number().int().min(0).max(100).openapi({
      description: "Processing progress (0-100%)",
    }),
    downloadUrl: z.string().nullable().openapi({
      description: "Presigned download URL when ready",
    }),
    error: z.string().nullable().openapi({
      description: "Error message if failed",
    }),
    createdAt: z.string().openapi({ description: "Job creation timestamp" }),
    updatedAt: z.string().openapi({ description: "Last update timestamp" }),
  })
  .openapi("JobStatusResponse");

const QueueStatsResponseSchema = z
  .object({
    queue: z.object({
      size: z.number().int(),
      activeJobs: z.number().int(),
    }),
    jobs: z.object({
      total: z.number().int(),
      queued: z.number().int(),
      processing: z.number().int(),
      ready: z.number().int(),
      failed: z.number().int(),
    }),
  })
  .openapi("QueueStatsResponse");

const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  })
  .openapi("ErrorResponse");

// ============== Routes ==============

/**
 * POST /v1/download/async
 * Start an async download job
 */
const asyncDownloadRoute = createRoute({
  method: "post",
  path: "/v1/download/async",
  tags: ["Async Download"],
  summary: "Start async download job",
  description: `Initiates an async download job that processes files in the background.
    Returns immediately with a jobId. Use the status endpoint to poll for completion.
    This avoids HTTP timeout issues for long-running downloads.`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: AsyncDownloadRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Job accepted and queued",
      content: {
        "application/json": {
          schema: AsyncDownloadResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

asyncDownloadRoutes.openapi(asyncDownloadRoute, async (c) => {
  const { file_ids } = c.req.valid("json");

  // Generate unique job ID
  const jobId = crypto.randomUUID();

  // Queue the job (creates in store + adds to queue)
  await queueDownloadJob(jobId, file_ids);

  console.log(
    `[AsyncDownload] Job ${jobId} queued with ${String(file_ids.length)} files`,
  );

  return c.json(
    {
      jobId,
      status: "queued" as const,
      message:
        "Download job queued successfully. Poll the status URL for progress.",
      totalFiles: file_ids.length,
      statusUrl: `/v1/download/status/${jobId}`,
    },
    202,
  );
});

// ============== Batch Job Endpoint (OPTIMIZATION) ==============

/**
 * POST /v1/download/batch
 * Create multiple download jobs at once
 * OPTIMIZATION: Reduces API call overhead for multiple concurrent downloads
 */
const BatchDownloadRequestSchema = z
  .object({
    jobs: z
      .array(
        z.object({
          file_ids: z
            .array(z.number().int().min(10000).max(100000000))
            .min(1)
            .max(1000),
        }),
      )
      .min(1)
      .max(10)
      .openapi({ description: "Array of jobs to create (max 10)" }),
  })
  .openapi("BatchDownloadRequest");

const BatchDownloadResponseSchema = z
  .object({
    jobs: z.array(
      z.object({
        jobId: z.string(),
        status: z.string(),
        totalFiles: z.number(),
        statusUrl: z.string(),
      }),
    ),
    message: z.string(),
  })
  .openapi("BatchDownloadResponse");

const batchDownloadRoute = createRoute({
  method: "post",
  path: "/v1/download/batch",
  tags: ["Async Download"],
  summary: "Create multiple download jobs at once",
  description: `OPTIMIZATION: Create up to 10 download jobs in a single API call.
    Reduces network overhead for concurrent downloads.
    Returns array of jobIds for tracking.`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: BatchDownloadRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Jobs accepted and queued",
      content: {
        "application/json": {
          schema: BatchDownloadResponseSchema,
        },
      },
    },
  },
});

asyncDownloadRoutes.openapi(batchDownloadRoute, async (c) => {
  const { jobs: jobRequests } = c.req.valid("json");

  // Create all jobs in parallel
  const createdJobs = await Promise.all(
    jobRequests.map(async (req) => {
      const jobId = crypto.randomUUID();
      await queueDownloadJob(jobId, req.file_ids);
      return {
        jobId,
        status: "queued",
        totalFiles: req.file_ids.length,
        statusUrl: `/v1/download/status/${jobId}`,
      };
    }),
  );

  console.log(
    `[AsyncDownload] Batch: ${String(createdJobs.length)} jobs created`,
  );

  return c.json(
    {
      jobs: createdJobs,
      message: `${String(createdJobs.length)} jobs queued successfully`,
    },
    202,
  );
});

/**
 * GET /v1/download/status/:jobId
 * Poll job status
 */
const jobStatusRoute = createRoute({
  method: "get",
  path: "/v1/download/status/{jobId}",
  tags: ["Async Download"],
  summary: "Get job status",
  description: `Poll the status of a download job.
    Returns progress percentage and download URL when ready.
    Recommended polling interval: 2-5 seconds.`,
  request: {
    params: z.object({
      jobId: z.uuid().openapi({ description: "Job ID from async download" }),
    }),
  },
  responses: {
    200: {
      description: "Job status",
      content: {
        "application/json": {
          schema: JobStatusResponseSchema,
        },
      },
    },
    404: {
      description: "Job not found",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

asyncDownloadRoutes.openapi(jobStatusRoute, (c) => {
  const { jobId } = c.req.valid("param");

  const job = jobStore.getJob(jobId);

  if (!job) {
    return c.json(
      {
        error: "Not Found",
        message: `Job ${jobId} not found`,
        requestId: c.req.header("x-request-id"),
      },
      404,
    );
  }

  // OPTIMIZATION: Add cache headers based on job status
  // - Completed jobs: Cache for 1 hour (immutable)
  // - In-progress jobs: Short cache (2 seconds) to reduce server load
  if (job.status === "ready" || job.status === "failed") {
    c.header("Cache-Control", "public, max-age=3600, immutable");
  } else {
    c.header("Cache-Control", "public, max-age=2");
  }

  return c.json(
    {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      downloadUrl: job.downloadUrl ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    },
    200,
  );
});

/**
 * GET /v1/download/queue/stats
 * Get queue statistics
 */
const queueStatsRoute = createRoute({
  method: "get",
  path: "/v1/download/queue/stats",
  tags: ["Async Download"],
  summary: "Get queue statistics",
  description:
    "Returns current queue size, active jobs, and job counts by status.",
  responses: {
    200: {
      description: "Queue statistics",
      content: {
        "application/json": {
          schema: QueueStatsResponseSchema,
        },
      },
    },
  },
});

asyncDownloadRoutes.openapi(queueStatsRoute, (c) => {
  const stats = getQueueStats();

  return c.json(
    {
      queue: {
        size: stats.queueSize,
        activeJobs: stats.activeJobs,
      },
      jobs: stats.jobStats,
    },
    200,
  );
});

// ============== SSE Subscribe Endpoint (Hybrid Pattern) ==============

/**
 * GET /v1/download/subscribe/:jobId
 * Server-Sent Events for real-time job updates
 *
 * This is the SSE part of our HYBRID approach:
 * - Modern clients use this for real-time updates (no polling needed)
 * - Legacy clients fall back to polling /status/:jobId
 *
 * SSE sends events:
 * - "connected" - Initial connection established
 * - "progress" - Job progress update (0-100%)
 * - "completed" - Job finished, includes downloadUrl
 * - "failed" - Job failed, includes error message
 * - "heartbeat" - Keep-alive every 15s
 */
asyncDownloadRoutes.get("/v1/download/subscribe/:jobId", (c) => {
  const jobId = c.req.param("jobId");

  // Validate UUID format
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(jobId)) {
    return c.json({ error: "Invalid jobId format" }, 400);
  }

  // Check if job exists
  const job = jobStore.getJob(jobId);
  if (!job) {
    return c.json({ error: "Job not found", jobId }, 404);
  }

  // If job is already complete, return immediately (no need for SSE)
  if (job.status === "ready" || job.status === "failed") {
    return c.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      downloadUrl: job.downloadUrl ?? null,
      error: job.error ?? null,
      message: "Job already completed. No SSE stream needed.",
    });
  }

  console.log(`[SSE] Client subscribed to job ${jobId}`);

  // Return SSE stream
  return streamSSE(c, async (stream) => {
    let isStreamActive = true;

    // Send initial connected event with current state
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        message: "Connected to job updates stream",
        timestamp: new Date().toISOString(),
      }),
    });

    // Event handler for job updates (async inner function)
    const processJobUpdate = async (event: {
      type: string;
      job: typeof job | undefined;
    }): Promise<void> => {
      if (!isStreamActive || !event.job) return;

      try {
        const eventData = {
          jobId: event.job.jobId,
          status: event.job.status,
          progress: event.job.progress,
          downloadUrl: event.job.downloadUrl ?? null,
          error: event.job.error ?? null,
          timestamp: new Date().toISOString(),
        };

        if (event.type === "updated") {
          await stream.writeSSE({
            event: "progress",
            data: JSON.stringify(eventData),
          });
        } else if (event.type === "completed") {
          await stream.writeSSE({
            event: "completed",
            data: JSON.stringify(eventData),
          });
          // Close stream after completion
          isStreamActive = false;
        } else if (event.type === "failed") {
          await stream.writeSSE({
            event: "failed",
            data: JSON.stringify(eventData),
          });
          // Close stream after failure
          isStreamActive = false;
        }
      } catch {
        // Stream closed by client
        isStreamActive = false;
      }
    };

    // Synchronous wrapper to handle Promise properly (avoids @typescript-eslint/no-misused-promises)
    const handleJobUpdate = (event: {
      type: string;
      job: typeof job | undefined;
    }): void => {
      void processJobUpdate(event);
    };

    // Subscribe to job events
    jobStore.on(`job:${jobId}`, handleJobUpdate);

    // Heartbeat to keep connection alive (every 15 seconds)
    const sendHeartbeat = async (): Promise<void> => {
      if (!isStreamActive) {
        clearInterval(heartbeatInterval);
        return;
      }
      try {
        await stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({
            timestamp: new Date().toISOString(),
            jobId,
          }),
        });
      } catch {
        isStreamActive = false;
        clearInterval(heartbeatInterval);
      }
    };

    const heartbeatInterval = setInterval(() => {
      void sendHeartbeat();
    }, 15000);

    // Wait for stream to close or job to complete
    // Using a simple polling approach to check if stream should close
    while (isStreamActive) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check if job completed while we were waiting
      const currentJob = jobStore.getJob(jobId);
      if (
        currentJob &&
        (currentJob.status === "ready" || currentJob.status === "failed")
      ) {
        isStreamActive = false;
      }
    }

    // Cleanup
    clearInterval(heartbeatInterval);
    jobStore.off(`job:${jobId}`, handleJobUpdate);
    console.log(`[SSE] Client disconnected from job ${jobId}`);
  });
});

export { asyncDownloadRoutes };
