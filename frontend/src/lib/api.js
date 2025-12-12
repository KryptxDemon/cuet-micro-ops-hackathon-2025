/**
 * API Client with Tracing Integration
 *
 * All API calls are automatically traced with OpenTelemetry.
 * Errors are captured by Sentry with trace context.
 */

import { withSpan, getCurrentTraceId, startTrace } from './tracing';
import { captureException, addBreadcrumb } from './sentry';

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Error class with trace context
export class ApiClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiClientError';
    this.traceId = options.traceId;
    this.statusCode = options.statusCode;
    this.endpoint = options.endpoint;
  }
}

/**
 * Make an API request with tracing
 * @param {string} endpoint - API endpoint
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<any>} Response data
 */
async function apiRequest(endpoint, options = {}) {
  const { span, traceId } = startTrace(`API ${options.method || 'GET'} ${endpoint}`);

  try {
    addBreadcrumb({
      category: 'api',
      message: `${options.method || 'GET'} ${endpoint}`,
      level: 'info',
      data: { traceId },
    });

    span.setAttributes({
      'http.method': options.method || 'GET',
      'http.url': `${API_BASE_URL}${endpoint}`,
      'trace.id': traceId,
    });

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-ID': traceId,
        ...options.headers,
      },
    });

    span.setAttributes({
      'http.status_code': response.status,
      'http.response_content_length': response.headers.get('content-length') || '0',
    });

    // Get request ID from response headers
    const requestId = response.headers.get('X-Request-ID');
    if (requestId) {
      span.setAttributes({ 'http.request_id': requestId });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiClientError(errorData.message || `HTTP ${response.status}`, {
        traceId,
        statusCode: response.status,
        endpoint,
      });
    }

    const data = await response.json();
    span.end();
    return data;
  } catch (error) {
    span.setAttributes({ 'error': true });
    span.end();

    if (error instanceof ApiClientError) {
      captureException(error, {
        traceId: error.traceId,
        tags: {
          endpoint: error.endpoint || endpoint,
          status_code: String(error.statusCode || 'unknown'),
        },
      });
      throw error;
    }

    const apiError = new ApiClientError(
      error instanceof Error ? error.message : 'Unknown error',
      { traceId, endpoint }
    );
    captureException(apiError, { traceId });
    throw apiError;
  }
}

/**
 * API Client
 */
export const api = {
  /**
   * Get health status
   * @returns {Promise<{status: string, checks: {storage: string}}>}
   */
  async getHealth() {
    return withSpan('api.health', async () => {
      return apiRequest('/health');
    });
  },

  /**
   * Check file availability
   * @param {number} fileId - File ID
   * @returns {Promise<{file_id: number, available: boolean, s3Key: string|null, size: number|null}>}
   */
  async checkDownload(fileId) {
    return withSpan(
      'api.download.check',
      async () => {
        return apiRequest('/v1/download/check', {
          method: 'POST',
          body: JSON.stringify({ file_id: fileId }),
        });
      },
      { 'file.id': String(fileId) }
    );
  },

  /**
   * Initiate async download job (Challenge 2 - Hybrid Pattern)
   * @param {number[]} fileIds - Array of file IDs
   * @returns {Promise<{jobId: string, status: string, totalFiles: number, statusUrl: string}>}
   */
  async initiateAsyncDownload(fileIds) {
    return withSpan(
      'api.download.async',
      async () => {
        return apiRequest('/v1/download/async', {
          method: 'POST',
          body: JSON.stringify({ file_ids: fileIds }),
        });
      },
      { 'files.count': String(fileIds.length) }
    );
  },

  /**
   * Get async job status (polling)
   * @param {string} jobId - Job ID
   * @returns {Promise<{jobId: string, status: string, progress: number, downloadUrl: string|null, error: string|null}>}
   */
  async getJobStatus(jobId) {
    return withSpan(
      'api.download.status',
      async () => {
        return apiRequest(`/v1/download/status/${jobId}`, {
          method: 'GET',
        });
      },
      { 'job.id': jobId }
    );
  },

  /**
   * Subscribe to job updates via SSE (real-time)
   * @param {string} jobId - Job ID
   * @param {function} onMessage - Callback for messages
   * @param {function} onError - Callback for errors
   * @returns {EventSource}
   */
  subscribeToJob(jobId, onMessage, onError) {
    const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const eventSource = new EventSource(`${API_BASE}/v1/download/subscribe/${jobId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('[SSE] Failed to parse message:', e);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('[SSE] Error:', error);
      if (onError) onError(error);
      eventSource.close();
    };
    
    return eventSource;
  },

  /**
   * Get current trace ID
   * @returns {string|null}
   */
  getTraceId() {
    return getCurrentTraceId();
  },
};
