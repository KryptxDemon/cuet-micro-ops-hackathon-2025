# Infrastructure Documentation

> **Member 2 (DevOps/Infrastructure)** - Complete guide to the infrastructure setup

This document explains how all the components work together in this system.

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Docker Network (delineate-network)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                  │
│   │   API       │────▶│   Redis     │◀────│   Worker    │                  │
│   │  (Port 3000)│     │ (Port 6379) │     │  (Background│                  │
│   │             │     │  Job Queue  │     │   Processor)│                  │
│   └──────┬──────┘     └─────────────┘     └──────┬──────┘                  │
│          │                                        │                         │
│          │           ┌─────────────┐             │                         │
│          └──────────▶│   MinIO     │◀────────────┘                         │
│                      │ (Port 9000) │                                        │
│                      │ S3 Storage  │                                        │
│                      └─────────────┘                                        │
│                                                                             │
│   ┌─────────────┐     ┌─────────────┐                                      │
│   │   Jaeger    │     │ MinIO Init  │                                      │
│   │(Port 16686) │     │ (Creates    │                                      │
│   │  Tracing UI │     │  Bucket)    │                                      │
│   └─────────────┘     └─────────────┘                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### One Command to Run Everything

```bash
# Start all services (API, Worker, Redis, MinIO, Jaeger)
npm run docker:dev
```

This will:

- ✅ Build the API container
- ✅ Build the Worker container
- ✅ Start Redis for job queues
- ✅ Start MinIO (S3-compatible storage)
- ✅ Create the `downloads` bucket automatically
- ✅ Start Jaeger for distributed tracing

### Verify Everything is Running

```bash
# Check API health
curl http://localhost:3000/health

# Expected response:
# {"status":"healthy","checks":{"storage":"ok"}}
```

---

## 📦 Services Overview

### 1. API Container (`delineate-app`)

| Property | Value                              |
| -------- | ---------------------------------- |
| Port     | 3000                               |
| Image    | Built from `docker/Dockerfile.dev` |
| Purpose  | Main application server            |

The API handles:

- HTTP requests from clients
- Creating download jobs in Redis queue
- Returning presigned URLs for downloads
- Health checks

### 2. Worker Container (`delineate-worker`)

| Property | Value                    |
| -------- | ------------------------ |
| Port     | None (internal only)     |
| Command  | `npm run worker`         |
| Purpose  | Background job processor |

The Worker handles:

- Processing download jobs from Redis queue
- Generating files and uploading to MinIO
- Long-running operations (avoids API timeouts)

### 3. Redis (`redis`)

| Property | Value              |
| -------- | ------------------ |
| Port     | 6379               |
| Image    | `redis:7-alpine`   |
| Purpose  | Job queue (BullMQ) |

Redis is used for:

- Storing download job queue
- Communication between API and Worker
- Caching (optional)

### 4. MinIO (`minio`)

| Property     | Value                       |
| ------------ | --------------------------- |
| S3 API Port  | 9000                        |
| Console Port | 9001                        |
| Image        | `minio/minio:latest`        |
| Credentials  | `minioadmin` / `minioadmin` |

MinIO provides:

- S3-compatible object storage
- File uploads/downloads
- Presigned URLs
- Web console for management

### 5. MinIO Init (`minio-init`)

| Property | Value                    |
| -------- | ------------------------ |
| Image    | `minio/mc:latest`        |
| Purpose  | One-time bucket creation |

This container:

- Waits for MinIO to be healthy
- Creates the `downloads` bucket
- Sets public download policy
- Exits after completion

### 6. Jaeger (`delineate-jaeger`)

| Property  | Value                             |
| --------- | --------------------------------- |
| UI Port   | 16686                             |
| OTLP Port | 4318                              |
| Image     | `jaegertracing/all-in-one:latest` |

Jaeger provides:

- Distributed tracing
- Request visualization
- Performance monitoring

---

## 🌐 Accessing Services

| Service       | URL                        | Purpose             |
| ------------- | -------------------------- | ------------------- |
| API           | http://localhost:3000      | Main application    |
| API Docs      | http://localhost:3000/docs | Swagger/OpenAPI     |
| MinIO Console | http://localhost:9001      | Storage management  |
| Jaeger UI     | http://localhost:16686     | Trace visualization |

### MinIO Console Login

- **Username**: `minioadmin`
- **Password**: `minioadmin`

---

## 🔧 Environment Configuration

### For Docker (`.env.docker`)

```env
# IMPORTANT: Use service names, NOT localhost!

# S3 (MinIO)
S3_ENDPOINT=http://minio:9000      # ← 'minio' is Docker service name
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET_NAME=downloads

# Redis
REDIS_HOST=redis                    # ← 'redis' is Docker service name
REDIS_PORT=6379

# Jaeger
OTEL_EXPORTER_OTLP_ENDPOINT=http://delineate-jaeger:4318
```

### For Local Development (`.env`)

```env
# Use localhost when running outside Docker

# S3 (MinIO)
S3_ENDPOINT=http://localhost:9000  # ← localhost for local dev
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET_NAME=downloads

# Redis
REDIS_HOST=localhost               # ← localhost for local dev
REDIS_PORT=6379
```

---

## 🐳 Docker Commands

### Basic Operations

```bash
# Start all services
npm run docker:dev

# Start in detached mode (background)
npm run docker:dev:detach

# Stop all services
npm run docker:down

# Stop and remove volumes (clean slate)
npm run docker:down:volumes

# View logs
npm run docker:logs

# View specific service logs
npm run docker:logs:api
npm run docker:logs:worker
```

### Manual Docker Commands

```bash
# Build and start
docker compose -f docker/compose.dev.yml up --build

# Start in background
docker compose -f docker/compose.dev.yml up -d

# View running containers
docker compose -f docker/compose.dev.yml ps

# Execute command in container
docker exec -it delineate-api sh

# Check MinIO bucket
docker exec delineate-minio mc ls local/downloads
```

---

## 🔄 How Components Communicate

### Request Flow: Download Initiation

```
1. Client → POST /v1/download/initiate
2. API receives request, validates input
3. API creates job in Redis queue
4. API returns jobId to client immediately
5. Worker picks up job from Redis
6. Worker processes files (with delay simulation)
7. Worker uploads to MinIO
8. Worker updates job status in Redis
9. Client polls /v1/download/status/:jobId
10. Client gets presigned URL when ready
```

### Internal DNS Resolution

Inside Docker, services communicate using service names:

```
delineate-app    → redis:6379        (Redis)
delineate-app    → minio:9000        (MinIO S3 API)
delineate-worker → redis:6379        (Redis)
delineate-worker → minio:9000        (MinIO S3 API)
```

---

## 🏥 Health Checks

### API Health Check

```bash
curl http://localhost:3000/health
```

Response when healthy:

```json
{
  "status": "healthy",
  "checks": {
    "storage": "ok"
  }
}
```

Response when unhealthy:

```json
{
  "status": "unhealthy",
  "checks": {
    "storage": "error"
  }
}
```

### Container Health Checks

All containers have built-in health checks:

| Service | Health Check       |
| ------- | ------------------ |
| API     | HTTP GET `/health` |
| Redis   | `redis-cli ping`   |
| MinIO   | `mc ready local`   |

---

## 📊 CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) includes:

### Pipeline Stages

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    Lint     │    │  Validate   │    │    Test     │    │    Build    │
│             │───▶│     Env     │───▶│    (E2E)    │───▶│   Docker    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                                │
                                                                ▼
                                                        ┌─────────────┐
                                                        │ Integration │
                                                        │    Test     │
                                                        └─────────────┘
```

### What Gets Tested

1. **Lint & Format**: ESLint + Prettier checks
2. **Environment Validation**: Required env vars present
3. **E2E Tests**: API endpoint testing
4. **Docker Build**: Both dev and prod images
5. **Integration Test**: Full docker-compose with health checks

---

## 🔒 Production Considerations

### Security

- [ ] Change MinIO credentials from default
- [ ] Use secrets management for credentials
- [ ] Enable TLS for all services
- [ ] Set up proper CORS origins

### Scaling

```yaml
# In compose.prod.yml, you can scale workers:
delineate-worker:
  deploy:
    replicas: 3
```

### Monitoring

- Use Jaeger for distributed tracing
- Configure Sentry for error tracking
- Set up alerts for health check failures

---

## 🐛 Troubleshooting

### MinIO Connection Error

```
Error: connect ECONNREFUSED 127.0.0.1:9000
```

**Solution**: Make sure `S3_ENDPOINT=http://minio:9000` in Docker (not localhost)

### Redis Connection Error

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solution**: Make sure `REDIS_HOST=redis` in Docker (not localhost)

### Bucket Not Found

```
Error: The specified bucket does not exist
```

**Solution**: The `minio-init` container should create it. Check:

```bash
docker logs delineate-minio-init
```

### Container Not Starting

Check logs:

```bash
docker compose -f docker/compose.dev.yml logs <service-name>
```

### Reset Everything

```bash
# Stop all containers and remove volumes
npm run docker:down:volumes

# Start fresh
npm run docker:dev
```

---

## 📁 File Structure

```
docker/
├── compose.dev.yml      # Development compose (all services)
├── compose.prod.yml     # Production compose (optimized)
├── Dockerfile.dev       # Development image (hot reload)
└── Dockerfile.prod      # Production image (multi-stage)

.env.docker              # Environment for Docker
.env.example             # Template with all variables
.env                     # Local development (gitignored)

.github/
└── workflows/
    └── ci.yml           # Complete CI/CD pipeline

src/
├── index.ts             # Main API application
└── worker.ts            # Background job processor
```

---

## ✅ Checklist for Integration

For **Backend (Member 1)**:

- [ ] Use `.env.docker` when running in Docker
- [ ] Connect to Redis at `redis:6379`
- [ ] Upload files to MinIO at `minio:9000`
- [ ] Create jobs with unique jobId

For **Frontend (Member 3)**:

- [ ] Call API at `http://localhost:3000`
- [ ] Poll `/v1/download/status/:jobId` for progress
- [ ] Use presigned URLs for downloads
- [ ] Handle timeout scenarios gracefully

---

## 📞 Quick Reference

| Action           | Command                                             |
| ---------------- | --------------------------------------------------- |
| Start everything | `npm run docker:dev`                                |
| Stop everything  | `npm run docker:down`                               |
| View logs        | `npm run docker:logs`                               |
| Clean restart    | `npm run docker:down:volumes && npm run docker:dev` |
| Check health     | `curl http://localhost:3000/health`                 |
| Access MinIO UI  | http://localhost:9001                               |
| Access Jaeger    | http://localhost:16686                              |
| Run E2E tests    | `npm run test:e2e`                                  |
