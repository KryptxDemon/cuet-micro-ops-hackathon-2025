import React from 'react';
import ReactDOM from 'react-dom/client';
import { initTracing } from './lib/tracing';
import { initSentry } from './lib/sentry';
import App from './App';
import './index.css';

// Initialize observability before rendering
// Order matters: tracing first, then Sentry (to link errors with traces)
initTracing();
initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
