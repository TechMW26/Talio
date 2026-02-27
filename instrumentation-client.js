// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

Sentry.init({
  dsn: "https://1630aa317562e12230644d479969dfd1@o4510792436023296.ingest.de.sentry.io/4510792441921616",

  // Disable performance tracing in development to avoid 429s and overhead
  integrations: isDev ? [] : [Sentry.replayIntegration()],
  tracesSampleRate: isDev ? 0 : 0.2,
  enableLogs: !isDev,
  replaysSessionSampleRate: isDev ? 0 : 0.1,
  replaysOnErrorSampleRate: isDev ? 0 : 1.0,
  sendDefaultPii: true,
  enabled: !isDev,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
