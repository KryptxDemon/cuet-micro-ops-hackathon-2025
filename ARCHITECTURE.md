# Architecture Design: Long-Running Download System

## Overview

This document describes the architecture for handling long-running file downloads that can take 10-120+ seconds, solving HTTP timeout issues when deployed behind reverse proxies like Cloudflare, nginx, or AWS ALB.

---

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser/App)                                │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTPS
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         REVERSE PROXY (Cloudflare/nginx)                         │
│                              Timeout: 100s                                       │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP (internal)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API SERVER (Hono)                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  POST /v1/download/async     → Creates job, returns jobId immediately   │    │
│  │  GET  /v1/download/status/:id → Returns job status & progress          │    │
│  │  GET  /v1/download/queue/stats → Queue statistics                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
          │                                              │
          │ Write to                                     │ Read from
          ▼                                              ▼
┌──────────────────────┐                    ┌──────────────────────┐
│     JOB STORE        │◄──────────────────►│     JOB QUEUE        │
│  (In-Memory/Redis)   │                    │  (In-Memory/BullMQ)  │
│                      │                    │                      │
│  - jobId             │                    │  - FIFO processing   │
│  - status            │                    │  - Concurrency: 2    │
│  - progress          │                    │  - Retry: 3 attempts │
│  - downloadUrl       │                    │                      │
└──────────────────────┘                    └──────────────────────┘
                                                       │
                                                       │ Process jobs
                                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              BACKGROUND WORKER                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Pick job from queue                                                 │    │
│  │  2. Update status → "processing"                                        │    │
│  │  3. Process each file (simulated delay)                                 │    │
│  │  4. Upload to S3                                                        │    │
│  │  5. Generate presigned URL                                              │    │
│  │  6. Update status → "ready" with downloadUrl                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ Upload files
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           S3-COMPATIBLE STORAGE                                  │
│                              (MinIO / AWS S3)                                    │
│                                                                                  │
│  Bucket: downloads/                                                              │
│  ├── 12345.zip                                                                   │
│  ├── 67890.zip                                                                   │
│  └── ...                                                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow for Download Request

```
┌──────┐    ┌─────────┐    ┌─────────┐    ┌────────┐    ┌──────┐
│Client│    │  Proxy  │    │   API   │    │ Worker │    │  S3  │
└──┬───┘    └────┬────┘    └────┬────┘    └───┬────┘    └──┬───┘
   │             │              │             │            │
   │ POST /async │              │             │            │
   │────────────►│─────────────►│             │            │
   │             │              │             │            │
   │             │    202 Accepted (jobId)    │            │
   │◄────────────│◄─────────────│             │            │
   │             │              │             │            │
   │             │              │ Queue Job   │            │
   │             │              │────────────►│            │
   │             │              │             │            │
   │ GET /status │              │             │ Process    │
   │────────────►│─────────────►│             │───────────►│
   │             │              │             │  Upload    │
   │   "processing" 50%         │             │            │
   │◄────────────│◄─────────────│             │            │
   │             │              │             │            │
   │ GET /status │              │             │ Presigned  │
   │────────────►│─────────────►│             │◄───────────│
   │             │              │             │    URL     │
   │  "ready" + downloadUrl     │             │            │
   │◄────────────│◄─────────────│             │            │
   │             │              │             │            │
   │ GET downloadUrl (direct S3 download)     │            │
   │──────────────────────────────────────────────────────►│
   │             │              │             │            │
   │        File Content        │             │            │
   │◄──────────────────────────────────────────────────────│
```

---

## 2. Technical Approach: Polling Pattern

### Why Polling?

We chose the **Polling Pattern** for the following reasons:

| Consideration             | Polling      | WebSocket        | Webhook         |
| ------------------------- | ------------ | ---------------- | --------------- |
| Implementation Complexity | Low ✅       | Medium           | High            |
| Client Compatibility      | Universal ✅ | Modern browsers  | Requires server |
| Proxy Friendly            | Yes ✅       | Requires config  | N/A             |
| Stateless Server          | Yes ✅       | No               | Yes             |
| Real-time Updates         | ~2-5s delay  | Instant          | Instant         |
| Resource Usage            | Moderate     | Low (persistent) | Low             |

**Polling is ideal because:**

1. Works behind any proxy without special configuration
2. Client can disconnect/reconnect without losing job state
3. Simple implementation with standard REST endpoints
4. No long-lived connections to manage

### Pattern Flow

```
Client                           Server
   │                                │
   │ POST /v1/download/async        │
   │ { file_ids: [1, 2, 3] }        │
   │───────────────────────────────►│
   │                                │ Create job in store
   │                                │ Add to queue
   │    202 { jobId, statusUrl }    │
   │◄───────────────────────────────│
   │                                │
   │  ┌─────────────────────────┐   │
   │  │ Poll every 2-5 seconds  │   │
   │  └─────────────────────────┘   │
   │                                │
   │ GET /v1/download/status/:jobId │
   │───────────────────────────────►│
   │   { status: "queued", 0% }     │
   │◄───────────────────────────────│
   │                                │
   │ GET /v1/download/status/:jobId │
   │───────────────────────────────►│
   │  { status: "processing", 50% } │
   │◄───────────────────────────────│
   │                                │
   │ GET /v1/download/status/:jobId │
   │───────────────────────────────►│
   │  { status: "ready", 100%,      │
   │    downloadUrl: "https://..." }│
   │◄───────────────────────────────│
   │                                │
   │ User clicks downloadUrl        │
   │ (Direct S3 presigned URL)      │
   │───────────────────────────────►│ S3
```

---

## 3. Implementation Details

### 3.1 API Contract

#### POST /v1/download/async - Initiate Download

**Request:**

```json
{
  "file_ids": [12345, 67890, 11111]
}
```

**Response (202 Accepted):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "message": "Download job queued successfully. Poll the status URL for progress.",
  "totalFiles": 3,
  "statusUrl": "/v1/download/status/550e8400-e29b-41d4-a716-446655440000"
}
```

#### GET /v1/download/status/:jobId - Check Status

**Response (200 OK):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "progress": 66,
  "downloadUrl": null,
  "error": null,
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:45.000Z"
}
```

**When ready:**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "ready",
  "progress": 100,
  "downloadUrl": "https://s3.example.com/downloads/550e8400.zip?X-Amz-...",
  "error": null,
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:32:15.000Z"
}
```

### 3.2 Job Status Schema

```typescript
interface Job {
  jobId: string; // UUID
  fileIds: number[]; // Files to process
  status: JobStatus; // queued | processing | ready | failed
  progress: number; // 0-100
  downloadUrl?: string; // Presigned S3 URL when ready
  error?: string; // Error message if failed
  createdAt: Date;
  updatedAt: Date;
}

type JobStatus = "queued" | "processing" | "ready" | "failed";
```

### 3.3 Queue System

**Current Implementation (In-Memory):**

- Simple FIFO queue with EventEmitter pattern
- Concurrency: 2 parallel jobs
- Retry: 3 attempts per job
- Suitable for development/hackathon

**Production Upgrade Path (BullMQ + Redis):**

```typescript
// Production configuration
const downloadQueue = new Queue("downloads", {
  connection: { host: "redis", port: 6379 },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});
```

### 3.4 Background Worker Processing

```typescript
async function processDownloadJob(job: QueueJob): Promise<void> {
  // 1. Update status to processing
  jobStore.updateJob(job.jobId, { status: "processing", progress: 0 });

  // 2. Process each file
  for (let i = 0; i < job.fileIds.length; i++) {
    await processFile(job.fileIds[i]); // Upload to S3

    // 3. Update progress
    const progress = Math.round(((i + 1) / job.fileIds.length) * 100);
    jobStore.updateJob(job.jobId, { progress });
  }

  // 4. Generate presigned URL
  const downloadUrl = await s3Service.generatePresignedUrl(s3Key);

  // 5. Mark as ready
  jobStore.updateJob(job.jobId, {
    status: "ready",
    progress: 100,
    downloadUrl,
  });
}
```

### 3.5 Error Handling & Retry Logic

```typescript
// Queue retry configuration
const MAX_RETRIES = 3;

// On job failure
if (job.attempts < MAX_RETRIES) {
  // Re-queue with exponential backoff
  queue.add(job.jobId, { delay: Math.pow(2, job.attempts) * 1000 });
  emit("job:retry", job);
} else {
  // Mark as failed after max retries
  jobStore.updateJob(job.jobId, {
    status: "failed",
    error: "Max retries exceeded",
  });
  emit("job:failed", job);
}
```

---

## 4. Proxy Configuration

### 4.1 Cloudflare Configuration

Cloudflare has a default 100-second timeout. With our polling pattern, this is not an issue since:

- `/async` endpoint returns in <1 second
- `/status` endpoint returns in <1 second

**Recommended Cloudflare settings:**

```
# Page Rules or Transform Rules
# No special configuration needed for polling pattern

# Optional: Increase timeout for presigned S3 URLs
# (if proxying S3 through Cloudflare)
Proxy Timeout: 100s (default is fine)
```

### 4.2 Nginx Configuration

```nginx
# /etc/nginx/conf.d/api.conf

upstream api_backend {
    server api:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name api.example.com;

    # Standard timeouts (sufficient for polling)
    proxy_connect_timeout 10s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;

    location / {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-ID $request_id;
    }

    # Health check endpoint (no caching)
    location /health {
        proxy_pass http://api_backend;
        proxy_cache off;
    }
}
```

### 4.3 AWS ALB Configuration

```yaml
# CloudFormation / Terraform
TargetGroup:
  HealthCheckPath: /health
  HealthCheckIntervalSeconds: 30
  HealthyThresholdCount: 2
  UnhealthyThresholdCount: 3
  TargetGroupAttributes:
    - Key: deregistration_delay.timeout_seconds
      Value: "30"

Listener:
  DefaultActions:
    - Type: forward
      TargetGroupArn: !Ref TargetGroup
  # Default idle timeout: 60s (sufficient for polling)
```

---

## 5. Frontend Integration

### 5.1 React Hook Implementation

```typescript
// hooks/useAsyncDownload.ts
import { useState, useCallback, useRef } from "react";

interface DownloadState {
  jobId: string | null;
  status: "idle" | "queued" | "processing" | "ready" | "failed";
  progress: number;
  downloadUrl: string | null;
  error: string | null;
}

export function useAsyncDownload() {
  const [state, setState] = useState<DownloadState>({
    jobId: null,
    status: "idle",
    progress: 0,
    downloadUrl: null,
    error: null,
  });

  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Start download
  const startDownload = useCallback(async (fileIds: number[]) => {
    try {
      const response = await fetch("/api/v1/download/async", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: fileIds }),
      });

      const data = await response.json();

      setState({
        jobId: data.jobId,
        status: "queued",
        progress: 0,
        downloadUrl: null,
        error: null,
      });

      // Start polling
      startPolling(data.jobId);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: "Failed to initiate download",
      }));
    }
  }, []);

  // Poll for status
  const startPolling = useCallback((jobId: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/download/status/${jobId}`);
        const data = await response.json();

        setState({
          jobId,
          status: data.status,
          progress: data.progress,
          downloadUrl: data.downloadUrl,
          error: data.error,
        });

        // Continue polling if not complete
        if (data.status === "queued" || data.status === "processing") {
          pollingRef.current = setTimeout(poll, 2000); // Poll every 2s
        }
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: "Failed to fetch status",
        }));
      }
    };

    poll();
  }, []);

  // Cleanup
  const cancel = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
    }
    setState({
      jobId: null,
      status: "idle",
      progress: 0,
      downloadUrl: null,
      error: null,
    });
  }, []);

  return { ...state, startDownload, cancel };
}
```

### 5.2 React Component Example

```tsx
// components/DownloadButton.tsx
import { useAsyncDownload } from "../hooks/useAsyncDownload";

export function DownloadButton({ fileIds }: { fileIds: number[] }) {
  const { status, progress, downloadUrl, error, startDownload, cancel } =
    useAsyncDownload();

  if (status === "idle") {
    return (
      <button onClick={() => startDownload(fileIds)}>
        Download {fileIds.length} files
      </button>
    );
  }

  if (status === "queued" || status === "processing") {
    return (
      <div className="download-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <span>
          {status === "queued" ? "Queued..." : `Processing ${progress}%`}
        </span>
        <button onClick={cancel}>Cancel</button>
      </div>
    );
  }

  if (status === "ready" && downloadUrl) {
    return (
      <a href={downloadUrl} download className="download-link">
        ✅ Download Ready - Click to Download
      </a>
    );
  }

  if (status === "failed") {
    return (
      <div className="download-error">
        <span>❌ {error}</span>
        <button onClick={() => startDownload(fileIds)}>Retry</button>
      </div>
    );
  }

  return null;
}
```

### 5.3 Next.js Integration

```tsx
// app/downloads/page.tsx
"use client";

import { useState } from "react";
import { DownloadButton } from "@/components/DownloadButton";

export default function DownloadsPage() {
  const [selectedFiles, setSelectedFiles] = useState<number[]>([]);

  return (
    <div>
      <h1>File Downloads</h1>

      {/* File selection UI */}
      <FileSelector onSelect={setSelectedFiles} selected={selectedFiles} />

      {/* Download button with progress */}
      {selectedFiles.length > 0 && <DownloadButton fileIds={selectedFiles} />}
    </div>
  );
}
```

---

## 6. Handling Edge Cases

### User Closes Browser Mid-Download

- Job continues processing in background
- User can return and poll with saved jobId
- Presigned URL remains valid for 24 hours

### Multiple Concurrent Downloads

- Each download gets unique jobId
- Queue processes with concurrency limit (2)
- Frontend can track multiple jobs independently

### Network Failures During Polling

```typescript
// Retry logic in frontend
const pollWithRetry = async (jobId: string, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`/api/v1/download/status/${jobId}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
};
```

---

## 7. Cost Considerations

| Component  | Development      | Production         |
| ---------- | ---------------- | ------------------ |
| Job Store  | In-Memory (free) | Redis ($15-50/mo)  |
| Queue      | In-Memory (free) | BullMQ + Redis     |
| S3 Storage | MinIO (free)     | AWS S3 ($0.023/GB) |
| Compute    | Single Node      | Multiple Workers   |

**Estimated Monthly Cost (Production):**

- Redis (managed): ~$25/month
- S3 Storage (100GB): ~$2.30/month
- S3 Transfer (1TB): ~$90/month
- Total: ~$120/month for moderate usage

---

## 8. Future Improvements

1. **WebSocket Support** - Add real-time progress for premium users
2. **Job Priority** - Priority queue for paid users
3. **File Compression** - ZIP multiple files into single download
4. **Resume Support** - Allow resuming failed downloads
5. **Expiration** - Auto-cleanup old jobs after 24 hours

---

## Summary

The polling pattern provides a robust, scalable solution for handling long-running downloads:

- ✅ **No timeout issues** - Requests complete in <1 second
- ✅ **Progress visibility** - Users see real-time progress
- ✅ **Fault tolerant** - Jobs survive disconnections
- ✅ **Proxy friendly** - Works with Cloudflare, nginx, ALB
- ✅ **Simple implementation** - Standard REST endpoints
- ✅ **Scalable** - Easy upgrade path to Redis/BullMQ
