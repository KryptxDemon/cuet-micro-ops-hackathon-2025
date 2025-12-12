import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

// Configuration
const OTEL_ENDPOINT =
  import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ||
  'http://localhost:4318';
const SERVICE_NAME = 'delineate-frontend';
const SERVICE_VERSION = '1.0.0';

// Create resource
const resource = new Resource({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
});

// Create exporter with error handling - disable credentials for CORS compatibility
const exporter = new OTLPTraceExporter({
  url: OTEL_ENDPOINT + '/v1/traces',
  headers: {},
  // Use fetch without credentials to avoid CORS issues with wildcard origin
  fetchImplementation: (url, options) => {
    return fetch(url, {
      ...options,
      credentials: 'omit', // Don't send credentials - allows wildcard CORS
    });
  },
});

// Create provider
const provider = new WebTracerProvider({
  resource,
});

// Add span processor with error handling
provider.addSpanProcessor(new BatchSpanProcessor(exporter, {
  // Export spans every 5 seconds or when buffer reaches 512 spans
  scheduledDelayMillis: 5000,
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
}));

// Set context manager for zone.js integration
provider.register({
  contextManager: new ZoneContextManager(),
});

// Register instrumentations
registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      // Propagate trace context to these URLs
      propagateTraceHeaderCorsUrls: [
        /localhost:3000/,
        /localhost:5173\/api/,
        new RegExp(import.meta.env.VITE_API_URL || 'localhost'),
      ],
      // Clear timing data after recording
      clearTimingResources: true,
    }),
    new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: [
        /localhost:3000/,
        /localhost:5173\/api/,
        new RegExp(import.meta.env.VITE_API_URL || 'localhost'),
      ],
    }),
    new DocumentLoadInstrumentation(),
    new UserInteractionInstrumentation({
      eventNames: ['click', 'submit'],
    }),
  ],
});

// Get tracer
const tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);

/**
 * Create a custom span for tracking user interactions
 * @param {string} name - Span name
 * @param {Object} attributes - Span attributes
 * @returns {import('@opentelemetry/api').Span}
 */
export function createSpan(name, attributes) {
  return tracer.startSpan(name, {
    attributes: {
      'ui.component': 'dashboard',
      ...attributes,
    },
  });
}

/**
 * Wrap an async function with tracing
 * @param {string} name - Span name
 * @param {function} fn - Async function to wrap
 * @param {Object} attributes - Span attributes
 * @returns {Promise<any>}
 */
export async function withSpan(name, fn, attributes) {
  const span = createSpan(name, attributes);

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () =>
      fn(span)
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Get the current trace ID for display
 * @returns {string|null}
 */
export function getCurrentTraceId() {
  const span = trace.getActiveSpan();
  if (span) {
    return span.spanContext().traceId;
  }
  return null;
}

/**
 * Create a trace ID for a new operation
 * @param {string} operationName - Operation name
 * @returns {{span: import('@opentelemetry/api').Span, traceId: string}}
 */
export function startTrace(operationName) {
  const span = tracer.startSpan(operationName);
  const traceId = span.spanContext().traceId;
  return { span, traceId };
}

/**
 * Add attributes to the current span
 * @param {Object} attributes - Attributes to add
 */
export function addSpanAttributes(attributes) {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Initialize OpenTelemetry tracing
 * Called once at application startup
 */
export function initTracing() {
  console.log('[OpenTelemetry] Tracing initialized for', SERVICE_NAME);
  console.log('[OpenTelemetry] OTLP endpoint:', OTEL_ENDPOINT);
}

export { tracer, provider };
