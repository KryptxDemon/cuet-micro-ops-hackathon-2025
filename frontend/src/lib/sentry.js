/**
 * Sentry Configuration for Error Tracking
 *
 * Features:
 * - Automatic error capture for unhandled exceptions
 * - Performance monitoring
 * - User feedback collection
 * - Integration with OpenTelemetry traces
 */

import * as Sentry from '@sentry/react';

// Configuration
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';
const ENVIRONMENT = import.meta.env.MODE || 'development';

/**
 * Initialize Sentry
 */
export function initSentry() {
  if (!SENTRY_DSN) {
    console.warn('[Sentry] No DSN provided, Sentry will not be initialized');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT,

    // Performance Monitoring
    tracesSampleRate: 1.0, // Capture 100% of transactions for development
    tracePropagationTargets: [
      'localhost',
      /^\//,
      new RegExp(import.meta.env.VITE_API_URL || 'localhost'),
    ],

    // Session Replay
    replaysSessionSampleRate: 0.1, // 10% of sessions
    replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors

    // Release tracking
    release: `delineate-frontend@${import.meta.env.VITE_APP_VERSION || '1.0.0'}`,

    // Integrations
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
      Sentry.feedbackIntegration({
        colorScheme: 'system',
        showBranding: false,
        buttonLabel: 'Report a Bug',
        submitButtonLabel: 'Send Feedback',
        formTitle: 'Report an Issue',
        messagePlaceholder: 'Describe what happened...',
      }),
    ],

    // Before sending event
    beforeSend(event, hint) {
      // Add trace ID if available
      const traceId = hint.originalException?.traceId;
      if (traceId) {
        event.tags = { ...event.tags, trace_id: traceId };
      }

      return event;
    },
  });

  console.log('[Sentry] Initialized successfully');
}

/**
 * Capture an exception with additional context
 * @param {Error} error
 * @param {Object} context
 * @param {string} [context.traceId]
 * @param {Object} [context.tags]
 * @param {Object} [context.extra]
 */
export function captureException(error, context) {
  Sentry.withScope((scope) => {
    if (context?.traceId) {
      scope.setTag('trace_id', context.traceId);
    }

    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    if (context?.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }

    Sentry.captureException(error);
  });
}

/**
 * Capture a message with context
 * @param {string} message
 * @param {'info' | 'warning' | 'error'} level
 * @param {Object} [context]
 * @param {string} [context.traceId]
 * @param {Object} [context.tags]
 */
export function captureMessage(message, level = 'info', context) {
  Sentry.withScope((scope) => {
    if (context?.traceId) {
      scope.setTag('trace_id', context.traceId);
    }

    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value);
      });
    }

    Sentry.captureMessage(message, level);
  });
}

/**
 * Set user context for error tracking
 * @param {Object | null} user
 * @param {string} [user.id]
 * @param {string} [user.email]
 * @param {string} [user.username]
 */
export function setUser(user) {
  Sentry.setUser(user);
}

/**
 * Add breadcrumb for debugging
 * @param {Object} breadcrumb
 * @param {string} breadcrumb.category
 * @param {string} breadcrumb.message
 * @param {'debug' | 'info' | 'warning' | 'error'} [breadcrumb.level]
 * @param {Object} [breadcrumb.data]
 */
export function addBreadcrumb(breadcrumb) {
  Sentry.addBreadcrumb({
    ...breadcrumb,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Show user feedback dialog
 */
export function showFeedbackDialog() {
  const feedback = Sentry.getFeedback();
  if (feedback) {
    feedback.createForm().then((form) => {
      if (form) {
        form.appendToDom();
      }
    }).catch((err) => {
      console.warn('[Sentry] Failed to create feedback form:', err);
    });
  }
}

export { Sentry };
