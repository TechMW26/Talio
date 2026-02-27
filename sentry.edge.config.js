// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isDev = process.env.NODE_ENV !== 'production';

Sentry.init({
  dsn: "https://1630aa317562e12230644d479969dfd1@o4510792436023296.ingest.de.sentry.io/4510792441921616",
  tracesSampleRate: isDev ? 0 : 0.2,
  enableLogs: !isDev,
  sendDefaultPii: true,
  enabled: !isDev,
});
