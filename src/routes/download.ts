/**
 * Async Download Routes
 *
 * New endpoints for the async download system:
 * - POST /v1/download/async   - Start async download job
 * - GET  /v1/download/status/:jobId - Poll job status
 * - GET  /v1/download/queue/stats   - Queue statistics
 *
 * These endpoints solve the HTTP timeout problem by:
 * 1. Immediately returning a jobId
 * 2. Processing in background
 * 3. Client polls status until ready
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
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

export { asyncDownloadRoutes };
