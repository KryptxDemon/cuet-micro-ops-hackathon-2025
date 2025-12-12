import { useState, useEffect, useCallback, Component } from 'react';
import * as Sentry from '@sentry/react';
import {
  Activity,
  Download,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Database,
  Server,
  Gauge,
  Bug,
  Layers,
  Clock,
  Timer,
  FileDown,
  Send,
  Trash2,
  Moon,
  Sun,
  Keyboard,
  X,
  TrendingUp,
  Zap,
  Loader2,
} from 'lucide-react';
import { api, ApiClientError } from './lib/api.js';
import { captureException, captureMessage, showFeedbackDialog } from './lib/sentry.js';
import { getCurrentTraceId, createSpan } from './lib/tracing.js';

// ============================================================================
// Toast Notification System
// ============================================================================

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type} animate-slide-in-right`}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'success' && <CheckCircle className="h-4 w-4" />}
            {toast.type === 'error' && <XCircle className="h-4 w-4" />}
            {toast.type === 'info' && <AlertCircle className="h-4 w-4" />}
            {toast.type === 'warning' && <AlertCircle className="h-4 w-4" />}
            <span className="text-sm">{toast.message}</span>
          </div>
          <button onClick={() => onDismiss(toast.id)} className="ml-2 hover:opacity-70">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Loading Skeleton Components
// ============================================================================

function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />;
}

function CardSkeleton() {
  return (
    <div className="card animate-pulse">
      <div className="card-header">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="card-content space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

// ============================================================================
// Keyboard Shortcuts Modal
// ============================================================================

function KeyboardShortcutsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'R', description: 'Refresh health status' },
    { key: 'D', description: 'Toggle dark mode' },
    { key: 'J', description: 'Open Jaeger UI' },
    { key: 'F', description: 'Open feedback dialog' },
    { key: '?', description: 'Show keyboard shortcuts' },
    { key: 'Esc', description: 'Close this modal' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Keyboard Shortcuts
          </h2>
          <button onClick={onClose} className="btn-ghost btn-icon btn-sm">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.key} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className="text-sm text-muted-foreground">{shortcut.description}</span>
              <kbd className="kbd">{shortcut.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Auto-Refresh Indicator
// ============================================================================

function AutoRefreshIndicator({ secondsLeft, isRefreshing }) {
  const percentage = (secondsLeft / 30) * 100;
  
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {isRefreshing ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Refreshing...</span>
        </>
      ) : (
        <>
          <div className="refresh-progress">
            <div 
              className="refresh-progress-bar" 
              style={{ width: `${percentage}%` }} 
            />
          </div>
          <span>{secondsLeft}s</span>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Error Boundary
// ============================================================================

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, traceId: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, traceId: getCurrentTraceId() };
  }

  componentDidCatch(error, errorInfo) {
    const traceId = getCurrentTraceId();
    captureException(error, {
      traceId,
      extra: { componentStack: errorInfo.componentStack },
    });
    console.error('Error boundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="card max-w-md w-full p-6 text-center">
            <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            {this.state.traceId && (
              <p className="text-xs text-muted-foreground mb-4 font-mono">
                Trace ID: {this.state.traceId}
              </p>
            )}
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="btn-primary"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Reload
              </button>
              <button
                onClick={() => showFeedbackDialog()}
                className="btn-outline"
              >
                <Bug className="h-4 w-4 mr-2" />
                Report Bug
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Health Status Component
// ============================================================================

function HealthStatus({ health, loading, error, onRefresh }) {
  const isHealthy = health?.status === 'healthy';
  const storageOk = health?.checks.storage === 'ok';

  return (
    <div className="card animate-fade-in">
      <div className="card-header flex-row items-center justify-between space-y-0 pb-2">
        <h3 className="text-sm font-medium">System Health</h3>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="btn-ghost btn-icon h-8 w-8"
          title="Refresh health status"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="card-content">
        {error ? (
          <div className="flex items-center gap-2 text-red-500">
            <XCircle className="h-5 w-5" />
            <span className="text-sm">{error}</span>
          </div>
        ) : loading && !health ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">Checking health...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Overall Status */}
            <div className="flex items-center gap-3">
              <div
                className={`status-dot ${isHealthy ? 'status-dot-healthy' : 'status-dot-unhealthy'}`}
              />
              <div>
                <p className="font-medium">
                  {isHealthy ? 'All Systems Operational' : 'System Issues Detected'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Last checked: {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>

            {/* Service Checks */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">API Server</span>
                </div>
                {isHealthy ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>

              <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">S3 Storage (MinIO)</span>
                </div>
                {storageOk ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Download Jobs Component
// ============================================================================

function DownloadJobs({ jobs, onInitiate, onClear }) {
  const [fileIdInput, setFileIdInput] = useState('');
  const [inputError, setInputError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const ids = fileIdInput
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id) && id >= 10000 && id <= 100000000);

    const invalidIds = fileIdInput
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id) && (id < 10000 || id > 100000000));

    if (invalidIds.length > 0) {
      setInputError('File IDs must be between 10,000 and 100,000,000');
      return;
    }

    if (ids.length > 0) {
      setInputError('');
      onInitiate(ids);
      setFileIdInput('');
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return <span className="badge badge-secondary">Pending</span>;
      case 'checking':
        return <span className="badge badge-outline">Checking</span>;
      case 'queued':
        return <span className="badge badge-secondary">Queued</span>;
      case 'processing':
        return <span className="badge badge-warning">Processing</span>;
      case 'downloading':
        return <span className="badge badge-warning">Downloading</span>;
      case 'ready':
      case 'completed':
        return <span className="badge badge-success animate-fade-in">Completed</span>;
      case 'failed':
        return <span className="badge badge-destructive animate-fade-in">Failed</span>;
      default:
        return null;
    }
  };

  // Get speed category based on elapsed time in seconds
  const getSpeedCategory = (elapsedSeconds) => {
    if (elapsedSeconds <= 15) {
      return { label: 'Fast', color: 'text-green-500', bgColor: 'bg-green-500/10', borderColor: 'border-green-500/30', range: '10-15s' };
    } else if (elapsedSeconds <= 60) {
      return { label: 'Medium', color: 'text-yellow-500', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/30', range: '30-60s' };
    } else {
      return { label: 'Slow', color: 'text-red-500', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', range: '60-120s' };
    }
  };

  // Calculate elapsed time in seconds
  const getElapsedTime = (job) => {
    if (job.startedAt && job.completedAt) {
      return Math.round((new Date(job.completedAt) - new Date(job.startedAt)) / 1000);
    }
    return null;
  };

  const getProgressPercentage = (job) => {
    // Use actual progress from async job if available
    if (job.progress !== undefined) {
      return job.progress;
    }
    // Fallback for status-based progress
    switch (job.status) {
      case 'pending': return 5;
      case 'checking': return 15;
      case 'queued': return 20;
      case 'processing': return 50;
      case 'downloading': return 70;
      case 'completed': return 100;
      case 'ready': return 100;
      case 'failed': return 100;
      default: return 0;
    }
  };

  const activeJobsCount = jobs.filter(j => ['pending', 'checking', 'downloading', 'queued', 'processing'].includes(j.status)).length;
  const completedJobsCount = jobs.filter(j => j.status === 'completed').length;
  const failedJobsCount = jobs.filter(j => j.status === 'failed').length;

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <FileDown className="h-4 w-4" />
            Download Jobs
            {jobs.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ({completedJobsCount}/{jobs.length} completed)
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {activeJobsCount > 0 && (
              <span className="badge badge-default animate-pulse">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {activeJobsCount} active
              </span>
            )}
            {jobs.length > 0 && (
              <button
                onClick={onClear}
                className="btn-ghost btn-sm text-muted-foreground"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="card-content space-y-4">
        {/* Stats Summary */}
        {jobs.length > 0 && (
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              Active: {activeJobsCount}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Completed: {completedJobsCount}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Failed: {failedJobsCount}
            </span>
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={fileIdInput}
              onChange={(e) => {
                setFileIdInput(e.target.value);
                setInputError('');
              }}
              placeholder="Enter file IDs (e.g., 10000, 10001, 10002)"
              className={`input flex-1 ${inputError ? 'border-red-500' : ''}`}
            />
            <button type="submit" className="btn-primary px-4 py-2 flex items-center gap-2 whitespace-nowrap">
              <Download className="h-4 w-4" />
              <span>Download</span>
            </button>
          </div>
          {inputError && (
            <p className="text-xs text-red-500">{inputError}</p>
          )}
        </form>

        {/* Quick Actions */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => onInitiate([10001, 10002, 10003])}
            className="btn-outline btn-sm"
          >
            <Zap className="h-3 w-3 mr-1" />
            Files 10001-10003
          </button>
          <button
            onClick={() => onInitiate([20001, 20002])}
            className="btn-outline btn-sm"
          >
            <Zap className="h-3 w-3 mr-1" />
            Files 20001-20002
          </button>
          <button
            onClick={() => onInitiate([30001])}
            className="btn-outline btn-sm"
          >
            <Zap className="h-3 w-3 mr-1" />
            File 30001
          </button>
          <button
            onClick={() => onInitiate([50000])}
            className="btn-ghost btn-sm text-muted-foreground"
          >
            Single file
          </button>
        </div>

        {/* Jobs List */}
        {jobs.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
            {jobs.map((job) => {
              const elapsedTime = getElapsedTime(job);
              const speedCategory = elapsedTime !== null ? getSpeedCategory(elapsedTime) : null;
              
              return (
                <div
                  key={job.id}
                  className={`job-card rounded-lg border p-3 transition-all ${
                    job.status === 'completed' || job.status === 'ready' ? 'border-green-500/30 bg-green-500/5' :
                    job.status === 'failed' ? 'border-red-500/30 bg-red-500/5' :
                    'border-border bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {job.status === 'pending' || job.status === 'checking' || job.status === 'downloading' || job.status === 'queued' || job.status === 'processing' ? (
                        <Loader2 className="h-4 w-4 text-blue-500 animate-spin flex-shrink-0" />
                      ) : job.status === 'completed' || job.status === 'ready' ? (
                        <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {job.totalFiles > 1 ? `${job.totalFiles} Files` : `File #${job.fileId}`}
                          {job.progress !== undefined && job.progress < 100 && (
                            <span className="ml-2 text-xs text-muted-foreground">({job.progress}%)</span>
                          )}
                        </p>
                        {job.error ? (
                          <p className="text-xs text-red-500 truncate">{job.error}</p>
                        ) : job.downloadUrl ? (
                          <a
                            href={job.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                          >
                            Download ready <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : job.serverJobId ? (
                          <p className="text-xs text-muted-foreground">
                            Job: {job.serverJobId.slice(0, 8)}...
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {job.traceId && `Trace: ${job.traceId.slice(0, 8)}...`}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Show speed category after completion */}
                      {(job.status === 'completed' || job.status === 'ready') && speedCategory && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${speedCategory.bgColor} ${speedCategory.borderColor} border ${speedCategory.color} font-medium`}>
                          {speedCategory.label} • {elapsedTime}s
                        </span>
                      )}
                      {getStatusBadge(job.status)}
                    </div>
                  </div>
                  {/* Progress Bar */}
                  {(job.status === 'pending' || job.status === 'checking' || job.status === 'downloading' || job.status === 'queued' || job.status === 'processing') && (
                    <div className="progress-bar mt-2">
                      <div 
                        className="progress-bar-fill transition-all duration-300" 
                        style={{ width: `${getProgressPercentage(job)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <Download className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">
              No download jobs yet
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Enter file IDs above or use quick actions to start
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Error Log Component
// ============================================================================

function ErrorLog({ errors, onClear, onTriggerError }) {
  const getLevelIcon = (level) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case 'info':
        return <CheckCircle className="h-4 w-4 text-blue-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Bug className="h-4 w-4" />
            Error Log
          </h3>
          <div className="flex gap-2">
            <button onClick={onTriggerError} className="btn-outline btn-sm">
              <AlertCircle className="h-3 w-3 mr-1" />
              Test Error
            </button>
            {errors.length > 0 && (
              <button
                onClick={onClear}
                className="btn-ghost btn-sm text-muted-foreground"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="card-content">
        {errors.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
            {errors.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 p-2 rounded-md bg-muted/50"
              >
                {getLevelIcon(entry.level)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate-2">{entry.message}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {entry.timestamp.toLocaleTimeString()}
                    </span>
                    {entry.traceId && (
                      <span className="text-xs font-mono text-muted-foreground">
                        {entry.traceId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No errors logged. Click "Test Error" to simulate one.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Trace Viewer Component
// ============================================================================

function TraceViewer({ currentTraceId, jaegerUrl }) {
  const copyTraceId = () => {
    if (currentTraceId) {
      navigator.clipboard.writeText(currentTraceId);
    }
  };

  return (
    <div className="card animate-fade-in h-full flex flex-col">
      <div className="card-header">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Layers className="h-4 w-4 text-purple-500" />
          Distributed Tracing
        </h3>
      </div>
      <div className="card-content space-y-4 flex-1 flex flex-col">
        {/* Current Trace */}
        <div className="p-3.5 rounded-xl bg-gradient-to-br from-muted/40 to-muted/60 border border-border/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Current Trace ID</p>
            {currentTraceId && (
              <button 
                onClick={copyTraceId}
                className="text-xs font-semibold text-primary hover:text-primary/80 transition-all hover:scale-105 px-2 py-1 rounded-md hover:bg-primary/10"
              >
                Copy
              </button>
            )}
          </div>
          <p className="font-mono text-xs break-all leading-relaxed text-foreground">
            {currentTraceId || <span className="text-muted-foreground italic">No active trace</span>}
          </p>
        </div>

        {/* Jaeger Links */}
        <div className="space-y-3 flex-1 flex flex-col justify-center">
          <a
            href={jaegerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full justify-center text-base py-3 h-auto font-semibold shadow-lg hover:shadow-xl transition-all"
          >
            <ExternalLink className="h-5 w-5 mr-2" />
            Open Jaeger UI
          </a>

          {currentTraceId && (
            <a
              href={`${jaegerUrl}/trace/${currentTraceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline w-full justify-center text-sm py-2.5 h-auto font-semibold hover:shadow-md transition-all"
            >
              <Activity className="h-4 w-4 mr-2" />
              View Current Trace
            </a>
          )}
        </div>

        {/* Info */}
        <div className="text-xs text-muted-foreground bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 p-3 rounded-xl mt-auto">
          <p className="flex items-center gap-2 font-medium">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            Traces sent via OpenTelemetry to Jaeger
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sentry Dashboard Component
// ============================================================================

function SentryDashboard({ onTriggerBackendError, onTriggerFrontendError, sentryUrl }) {
  const [testResults, setTestResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const addTestResult = (type, success, message) => {
    setTestResults(prev => [
      { id: crypto.randomUUID(), type, success, message, timestamp: new Date() },
      ...prev.slice(0, 4) // Keep last 5 results
    ]);
  };

  const triggerBackendSentryTest = async () => {
    setIsLoading(true);
    try {
      // Call backend endpoint with sentry_test=true to trigger error
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/v1/download/check/99999?sentry_test=true`);
      if (!response.ok) {
        addTestResult('backend', true, 'Backend Sentry error triggered successfully!');
        onTriggerBackendError?.();
      }
    } catch (error) {
      addTestResult('backend', true, 'Backend Sentry error triggered!');
      onTriggerBackendError?.();
    } finally {
      setIsLoading(false);
    }
  };

  const triggerFrontendSentryTest = () => {
    try {
      onTriggerFrontendError?.();
      addTestResult('frontend', true, 'Frontend Sentry error captured!');
    } catch (error) {
      addTestResult('frontend', false, 'Failed to trigger frontend error');
    }
  };

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Bug className="h-4 w-4 text-pink-500" />
            Sentry Error Tracking
          </h3>
          <a
            href={sentryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost btn-sm text-pink-500 hover:text-pink-400"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Dashboard
          </a>
        </div>
      </div>
      <div className="card-content space-y-4">
        {/* Test Buttons */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Trigger Test Errors</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={triggerBackendSentryTest}
              disabled={isLoading}
              className="btn-outline btn-sm flex items-center justify-center gap-2 border-red-500/50 hover:bg-red-500/10 hover:border-red-500 text-red-500"
            >
              {isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Server className="h-3 w-3" />
              )}
              Backend Error
            </button>
            <button
              onClick={triggerFrontendSentryTest}
              className="btn-outline btn-sm flex items-center justify-center gap-2 border-orange-500/50 hover:bg-orange-500/10 hover:border-orange-500 text-orange-500"
            >
              <Activity className="h-3 w-3" />
              Frontend Error
            </button>
          </div>
        </div>

        {/* Open Sentry Dashboard */}
        <a
          href={sentryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary w-full justify-center bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700"
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Open Sentry Dashboard
        </a>

        {/* Test Results */}
        {testResults.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Recent Tests</p>
            <div className="space-y-1 max-h-24 overflow-y-auto scrollbar-thin">
              {testResults.map((result) => (
                <div
                  key={result.id}
                  className={`text-xs p-2 rounded-md flex items-center gap-2 ${
                    result.success 
                      ? 'bg-green-500/10 text-green-500' 
                      : 'bg-red-500/10 text-red-500'
                  }`}
                >
                  {result.success ? (
                    <CheckCircle className="h-3 w-3 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3 w-3 flex-shrink-0" />
                  )}
                  <span className="truncate">{result.message}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {result.type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="text-xs text-muted-foreground bg-gradient-to-r from-pink-500/10 to-purple-500/10 border border-pink-500/20 p-2 rounded-md">
          <p className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-pink-500" />
            Errors are automatically captured and sent to Sentry
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Performance Metrics Component
// ============================================================================

function PerformanceMetrics({ metrics }) {
  const successRate =
    metrics.totalRequests > 0
      ? ((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(1)
      : '0.0';

  const getResponseTimeColor = () => {
    if (metrics.averageResponseTime < 100) return 'text-green-500';
    if (metrics.averageResponseTime < 300) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getSuccessRateColor = () => {
    const rate = parseFloat(successRate);
    if (rate >= 95) return 'text-green-500';
    if (rate >= 80) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="card animate-fade-in">
      <div className="card-header">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Performance Metrics
          </h3>
          {metrics.totalRequests > 0 && (
            <span className="badge badge-secondary text-xs">
              <TrendingUp className="h-3 w-3 mr-1" />
              Live
            </span>
          )}
        </div>
      </div>
      <div className="card-content">
        {/* Success Rate Progress Bar */}
        {metrics.totalRequests > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Success Rate</span>
              <span className={`text-xs font-medium ${getSuccessRateColor()}`}>{successRate}%</span>
            </div>
            <div className="progress-bar">
              <div 
                className="progress-bar-fill"
                style={{ 
                  width: `${successRate}%`,
                  background: parseFloat(successRate) >= 95 
                    ? 'linear-gradient(90deg, #10b981, #34d399)' 
                    : parseFloat(successRate) >= 80 
                    ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                    : 'linear-gradient(90deg, #ef4444, #f87171)'
                }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="h-4 w-4 text-blue-500" />
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <p className="text-2xl font-bold">{metrics.totalRequests}</p>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <p className="text-xs text-muted-foreground">Success</p>
            </div>
            <p className="text-2xl font-bold text-green-500">{metrics.successfulRequests}</p>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="h-4 w-4 text-red-500" />
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
            <p className="text-2xl font-bold text-red-500">{metrics.failedRequests}</p>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-purple-500" />
              <p className="text-xs text-muted-foreground">Avg Time</p>
            </div>
            <p className={`text-2xl font-bold ${getResponseTimeColor()}`}>
              {metrics.averageResponseTime.toFixed(0)}<span className="text-sm">ms</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main App Component
// ============================================================================

function App() {
  // Dark mode state with localStorage persistence
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Toast notifications
  const [toasts, setToasts] = useState([]);

  // Keyboard shortcuts modal
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Auto-refresh countdown
  const [refreshCountdown, setRefreshCountdown] = useState(30);

  // State
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true); // Start with loading
  const [healthError, setHealthError] = useState(null);

  const [jobs, setJobs] = useState([]);
  const [errors, setErrors] = useState([]);
  const [currentTraceId, setCurrentTraceId] = useState(null);

  const [metrics, setMetrics] = useState({
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    responseTimes: [],
  });

  const jaegerUrl = import.meta.env.VITE_JAEGER_URL || 'http://localhost:16686';
  
  // Sentry Dashboard URL - Extract from DSN
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN || '';
  const sentryUrl = sentryDsn 
    ? `https://sentry.io/organizations/o4510521239994368/issues/?project=4510521242157056`
    : 'https://sentry.io';

  // Toast helpers
  const addToast = useCallback((message, type = 'info') => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Dark mode effect
  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleDarkMode = useCallback(() => {
    setIsDarkMode((prev) => !prev);
    addToast(isDarkMode ? 'Light mode enabled' : 'Dark mode enabled', 'info');
  }, [isDarkMode, addToast]);

  // Add error to log
  const addError = useCallback((message, level = 'error') => {
    const traceId = getCurrentTraceId();
    setErrors((prev) => [
      {
        id: `error-${crypto.randomUUID()}`,
        message,
        timestamp: new Date(),
        traceId,
        level,
      },
      ...prev.slice(0, 49), // Keep last 50 errors
    ]);
  }, []);

  // Update metrics
  const updateMetrics = useCallback((success, responseTime) => {
    setMetrics((prev) => {
      const newResponseTimes = [...prev.responseTimes, responseTime].slice(-100);
      const avgTime =
        newResponseTimes.reduce((a, b) => a + b, 0) / newResponseTimes.length;

      return {
        totalRequests: prev.totalRequests + 1,
        successfulRequests: prev.successfulRequests + (success ? 1 : 0),
        failedRequests: prev.failedRequests + (success ? 0 : 1),
        averageResponseTime: avgTime,
        responseTimes: newResponseTimes,
      };
    });
  }, []);

  // Fetch health status
  const fetchHealth = useCallback(async (showToast = false) => {
    setHealthLoading(true);
    setHealthError(null);
    const startTime = performance.now();

    try {
      const data = await api.getHealth();
      setHealth(data);
      setCurrentTraceId(getCurrentTraceId());
      updateMetrics(true, performance.now() - startTime);
      if (showToast) {
        addToast('Health status refreshed', 'success');
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : 'Failed to fetch health';
      setHealthError(message);
      addError(message);
      updateMetrics(false, performance.now() - startTime);
      if (showToast) {
        addToast('Failed to refresh health status', 'error');
      }
    } finally {
      setHealthLoading(false);
      setRefreshCountdown(30);
    }
  }, [updateMetrics, addError, addToast]);

  // Process async download job with polling (Challenge 2 - Hybrid Pattern)
  const processAsyncDownloadJob = useCallback(async (localJobId, fileIds) => {
    const startTime = performance.now();

    try {
      // Update to checking
      setJobs((prev) =>
        prev.map((j) => (j.id === localJobId ? { ...j, status: 'checking' } : j))
      );

      // Initiate async download
      const asyncResult = await api.initiateAsyncDownload(fileIds);
      const serverJobId = asyncResult.jobId;

      // Update with server job ID
      setJobs((prev) =>
        prev.map((j) =>
          j.id === localJobId
            ? { ...j, serverJobId, status: 'downloading', progress: 0 }
            : j
        )
      );

      // Poll for status (Polling Pattern)
      const pollStatus = async () => {
        try {
          const status = await api.getJobStatus(serverJobId);
          
          // Update progress
          setJobs((prev) =>
            prev.map((j) =>
              j.id === localJobId
                ? { ...j, progress: status.progress, status: status.status === 'ready' ? 'completed' : status.status === 'failed' ? 'failed' : 'downloading' }
                : j
            )
          );

          if (status.status === 'ready') {
            // Job completed successfully
            setJobs((prev) =>
              prev.map((j) =>
                j.id === localJobId
                  ? {
                      ...j,
                      status: 'completed',
                      downloadUrl: status.downloadUrl,
                      progress: 100,
                      completedAt: new Date(),
                    }
                  : j
              )
            );
            setCurrentTraceId(getCurrentTraceId());
            updateMetrics(true, performance.now() - startTime);
            addToast(`Download ready for ${fileIds.length} file(s)`, 'success');
            return; // Stop polling
          } else if (status.status === 'failed') {
            // Job failed
            setJobs((prev) =>
              prev.map((j) =>
                j.id === localJobId
                  ? {
                      ...j,
                      status: 'failed',
                      error: status.error || 'Download failed',
                      completedAt: new Date(),
                    }
                  : j
              )
            );
            addError(status.error || 'Download failed');
            updateMetrics(false, performance.now() - startTime);
            return; // Stop polling
          }

          // Continue polling every 2 seconds
          setTimeout(pollStatus, 2000);
        } catch (pollError) {
          console.error('[Polling] Error:', pollError);
          // Retry polling on error
          setTimeout(pollStatus, 5000);
        }
      };

      // Start polling
      pollStatus();

    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : `Download failed for files`;

      setJobs((prev) =>
        prev.map((j) =>
          j.id === localJobId
            ? {
                ...j,
                status: 'failed',
                error: message,
                completedAt: new Date(),
              }
            : j
        )
      );

      addError(message);
      updateMetrics(false, performance.now() - startTime);
    }
  }, [addError, updateMetrics, addToast]);

  // Initiate download jobs using async system
  const initiateDownloads = useCallback(async (fileIds) => {
    const span = createSpan('initiateDownloads');
    addToast(`Starting async download for ${fileIds.length} file(s)`, 'info');

    const localJobId = `job-${crypto.randomUUID()}`;
    const traceId = getCurrentTraceId();

    // Add pending job (single job for all files)
    setJobs((prev) => [
      {
        id: localJobId,
        fileIds,
        fileId: fileIds[0], // Show first file ID for display
        totalFiles: fileIds.length,
        status: 'pending',
        progress: 0,
        traceId,
        startedAt: new Date(),
      },
      ...prev,
    ]);

    // Process job asynchronously
    processAsyncDownloadJob(localJobId, fileIds);

    span.end();
  }, [addToast, processAsyncDownloadJob]);

  // Trigger test error
  const triggerTestError = useCallback(() => {
    try {
      captureMessage('Test error triggered from dashboard', 'warning');
      addError('Test error triggered', 'warning');
      addToast('Test error triggered', 'warning');

      // Also throw an actual error to test error boundary
      throw new Error('This is a test error from the dashboard');
    } catch (error) {
      if (error instanceof Error) {
        captureException(error);
        addError(error.message, 'error');
      }
    }
  }, [addError, addToast]);

  // Initial health check and auto-refresh
  useEffect(() => {
    fetchHealth();

    // Auto-refresh health every 30 seconds
    const interval = setInterval(() => fetchHealth(), 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // Countdown timer
  useEffect(() => {
    const countdownInterval = setInterval(() => {
      setRefreshCountdown((prev) => (prev > 0 ? prev - 1 : 30));
    }, 1000);
    return () => clearInterval(countdownInterval);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'r':
          e.preventDefault();
          fetchHealth(true);
          break;
        case 'd':
          e.preventDefault();
          toggleDarkMode();
          break;
        case 'j':
          e.preventDefault();
          window.open(jaegerUrl, '_blank');
          break;
        case 'f':
          e.preventDefault();
          showFeedbackDialog();
          break;
        case '?':
          e.preventDefault();
          setShowShortcuts(true);
          break;
        case 'escape':
          setShowShortcuts(false);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fetchHealth, toggleDarkMode, jaegerUrl]);

  return (
    <ErrorBoundary>
      <div className={`min-h-screen bg-gradient-to-br from-violet-50 via-purple-50 to-indigo-100 dark:from-gray-950 dark:via-purple-950 dark:to-indigo-950 transition-all duration-500`}>
        {/* Toast Notifications */}
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />

        {/* Keyboard Shortcuts Modal */}
        <KeyboardShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

        {/* Modern Header with Glassmorphism */}
        <header className="sticky top-0 z-50 glass border-b backdrop-blur-xl">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl blur-xl opacity-50 animate-pulse-slow"></div>
                  <div className="relative bg-gradient-to-r from-purple-600 to-indigo-600 p-2 rounded-2xl">
                    <Activity className="h-6 w-6 text-white" />
                  </div>
                </div>
                <div>
                  <h1 className="text-2xl font-bold">
                    <span className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 bg-clip-text text-transparent">
                      Delineate Dashboard
                    </span>
                  </h1>
                  <p className="text-xs text-muted-foreground font-medium">
                    Hackathon 2025 • Observability Platform
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Auto-refresh indicator */}
                <AutoRefreshIndicator secondsLeft={refreshCountdown} isRefreshing={healthLoading} />
                
                <div className="h-6 w-px bg-gradient-to-b from-transparent via-border to-transparent" />

                <button
                  onClick={toggleDarkMode}
                  className="btn-ghost btn-icon btn-sm hover:scale-110 transition-transform"
                  title="Toggle dark mode (D)"
                >
                  {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>

                <button
                  onClick={() => setShowShortcuts(true)}
                  className="btn-ghost btn-icon btn-sm hover:scale-110 transition-transform"
                  title="Keyboard shortcuts (?)"
                >
                  <Keyboard className="h-4 w-4" />
                </button>

                <a
                  href={jaegerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline btn-sm hover:scale-105 transition-transform"
                >
                  <Layers className="h-4 w-4 mr-1.5" />
                  Jaeger
                </a>
                <a
                  href={sentryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline btn-sm hover:scale-105 transition-transform border-pink-500/50 text-pink-500 hover:bg-pink-500/10"
                >
                  <Bug className="h-4 w-4 mr-1.5" />
                  Sentry
                </a>
                <button
                  onClick={() => showFeedbackDialog()}
                  className="btn-primary btn-sm hover:scale-105 transition-transform"
                >
                  <Send className="h-4 w-4 mr-1.5" />
                  Feedback
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 py-8">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Health Status */}
            <div className="lg:col-span-1">
              {healthLoading && !health ? (
                <CardSkeleton />
              ) : (
                <HealthStatus
                  health={health}
                  loading={healthLoading}
                  error={healthError}
                  onRefresh={() => fetchHealth(true)}
                />
              )}
            </div>

            {/* Performance Metrics */}
            <div className="lg:col-span-1">
              <PerformanceMetrics metrics={metrics} />
            </div>

            {/* Trace Viewer */}
            <div className="lg:col-span-1">
              <TraceViewer currentTraceId={currentTraceId} jaegerUrl={jaegerUrl} />
            </div>

            {/* Download Jobs - Full Width */}
            <div className="md:col-span-2 lg:col-span-2">
              <DownloadJobs
                jobs={jobs}
                onInitiate={initiateDownloads}
                onClear={() => {
                  setJobs([]);
                  addToast('Download history cleared', 'info');
                }}
              />
            </div>

            {/* Error Log */}
            <div className="lg:col-span-1">
              <ErrorLog
                errors={errors}
                onClear={() => {
                  setErrors([]);
                  addToast('Error log cleared', 'info');
                }}
                onTriggerError={triggerTestError}
              />
            </div>

            {/* Sentry Dashboard */}
            <div className="md:col-span-2 lg:col-span-2">
              <SentryDashboard
                sentryUrl={sentryUrl}
                onTriggerBackendError={() => {
                  addError('Backend Sentry test error triggered', 'error');
                  addToast('Backend error sent to Sentry', 'warning');
                }}
                onTriggerFrontendError={() => {
                  captureMessage('Frontend test error from dashboard', 'error');
                  addError('Frontend Sentry test error triggered', 'warning');
                  addToast('Frontend error sent to Sentry', 'warning');
                }}
              />
            </div>
          </div>
        </main>

        {/* Modern Footer with gradient */}
        <footer className="border-t mt-12 glass backdrop-blur-xl">
          <div className="container mx-auto px-4 py-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="relative">
                  <Zap className="h-5 w-5 text-yellow-500" />
                  <span className="absolute inset-0 animate-ping">
                    <Zap className="h-5 w-5 text-yellow-500 opacity-75" />
                  </span>
                </div>
                <span className="font-semibold">CUET Micro-Ops Hackathon 2025</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Powered by</span>
                <span className="px-2 py-1 rounded-lg bg-gradient-to-r from-blue-500/10 to-blue-600/10 text-blue-600 dark:text-blue-400 font-semibold">React</span>
                <span className="px-2 py-1 rounded-lg bg-gradient-to-r from-purple-500/10 to-purple-600/10 text-purple-600 dark:text-purple-400 font-semibold">Sentry</span>
                <span className="px-2 py-1 rounded-lg bg-gradient-to-r from-green-500/10 to-green-600/10 text-green-600 dark:text-green-400 font-semibold">OpenTelemetry</span>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}

export default Sentry.withProfiler(App);
