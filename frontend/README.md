# Frontend Dashboard - Observability Demo

A React dashboard application demonstrating end-to-end observability with **Sentry error tracking** and **OpenTelemetry distributed tracing**.

## 🎯 Features

### Health Monitoring

- Real-time API health status
- S3 storage connectivity check
- Auto-refresh every 30 seconds

### Download Job Management

- Initiate file downloads with tracing
- Track job progress (pending → checking → downloading → completed)
- View download URLs when complete
- Error handling with trace context

### Error Tracking (Sentry)

- Automatic error capture with stack traces
- React Error Boundary integration
- User feedback dialog
- Custom error logging with trace IDs

### Distributed Tracing (OpenTelemetry)

- Automatic instrumentation for fetch/XHR
- W3C Trace Context propagation (traceparent headers)
- Current trace ID display
- Direct links to Jaeger UI

### Performance Metrics

- Total request count
- Success/failure rates
- Average response times
- Real-time updates

## 🚀 Quick Start

### Prerequisites

- Node.js 24+
- Backend API running on port 3000
- Jaeger running on port 16686 (optional for tracing)

### Local Development

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Start development server
npm run dev
```

The dashboard will be available at http://localhost:5173

### With Docker Compose

```bash
# From project root
docker compose -f docker/compose.dev.yml up -d

# Access the dashboard
open http://localhost:5173
```

## 🔧 Configuration

### Environment Variables

| Variable                           | Description              | Default                  |
| ---------------------------------- | ------------------------ | ------------------------ |
| `VITE_API_URL`                     | Backend API URL          | `http://localhost:3000`  |
| `VITE_JAEGER_URL`                  | Jaeger UI URL            | `http://localhost:16686` |
| `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint for traces | `http://localhost:4318`  |
| `VITE_SENTRY_DSN`                  | Sentry DSN (optional)    | -                        |

### Sentry Setup (Optional)

1. Create a project at [sentry.io](https://sentry.io)
2. Copy your DSN from Project Settings > Client Keys
3. Add to `.env.local`:
   ```
   VITE_SENTRY_DSN=https://your-key@sentry.io/project-id
   ```

## 📁 Project Structure

```
frontend/
├── src/
│   ├── lib/
│   │   ├── api.ts        # API client with tracing
│   │   ├── sentry.ts     # Sentry configuration
│   │   └── tracing.ts    # OpenTelemetry setup
│   ├── App.tsx           # Main dashboard component
│   ├── index.css         # Tailwind + custom styles
│   └── main.tsx          # App entry point
├── Dockerfile.dev        # Development container
├── Dockerfile.prod       # Production multi-stage build
├── nginx.conf            # Production nginx config
└── package.json
```

## 🔍 Observability Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     React Frontend                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │    Sentry    │  │ OpenTelemetry│  │  Dashboard   │       │
│  │   (Errors)   │  │  (Tracing)   │  │    UI        │       │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘       │
└─────────┼─────────────────┼──────────────────────────────────┘
          │                 │
          │                 │ OTLP/HTTP (port 4318)
          │                 │ + traceparent header
          │                 ▼
          │         ┌──────────────┐
          │         │    Jaeger    │ ◄── View traces at :16686
          │         │  All-in-One  │
          │         └──────────────┘
          │
          ▼
   ┌──────────────┐
   │   Sentry.io  │ ◄── View errors at sentry.io
   │    (Cloud)   │
   └──────────────┘
```

### Trace Flow

1. User clicks "Download" button
2. Frontend creates span: `initiateDownloads`
3. API call made with `traceparent` header
4. Backend receives trace context
5. Backend creates child spans
6. All spans visible in Jaeger UI

### Error Flow

1. Error occurs in frontend
2. Sentry captures error with:
   - Stack trace
   - Trace ID (links to Jaeger)
   - User context
   - Breadcrumbs
3. Error visible in Sentry dashboard
4. Local error log updated in UI

## 🎨 Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **@sentry/react** - Error tracking
- **@opentelemetry/sdk-trace-web** - Distributed tracing

## 📊 Dashboard Components

| Component            | Description                            |
| -------------------- | -------------------------------------- |
| `HealthStatus`       | API/storage health with auto-refresh   |
| `DownloadJobs`       | File download management with progress |
| `ErrorLog`           | Recent errors with trace IDs           |
| `TraceViewer`        | Current trace ID + Jaeger links        |
| `PerformanceMetrics` | Request stats and response times       |

## 🧪 Testing Observability

### Test Error Tracking

1. Click "Test Error" button in Error Log card
2. Check Sentry dashboard for the error
3. Note the trace ID linking to Jaeger

### Test Distributed Tracing

1. Initiate a download (e.g., Files 1-3)
2. Note the trace ID in Trace Viewer
3. Click "View Current Trace" to see in Jaeger
4. Observe spans: frontend → API → storage

### Test Health Monitoring

1. Stop MinIO container: `docker stop delineate-minio`
2. Refresh health status
3. Observe storage check failure
4. Restart: `docker start delineate-minio`

## 🚢 Production Build

```bash
# Build production assets
npm run build

# Preview production build
npm run preview

# Build Docker image
docker build -f Dockerfile.prod -t delineate-frontend:prod .

# Run production container
docker run -p 80:80 delineate-frontend:prod
```

## 📝 License

MIT License - Part of CUET Micro-Ops Hackathon 2025
