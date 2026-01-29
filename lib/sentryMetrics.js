import * as Sentry from "@sentry/nextjs";

const hasMetricsApi = () =>
  Boolean(Sentry?.metrics && typeof Sentry.metrics.count === "function");

const normalizeOptions = (tags) => {
  if (!tags || typeof tags !== "object") return undefined;
  return { tags };
};

export const countMetric = (name, value = 1, tags) => {
  if (!hasMetricsApi()) return;
  Sentry.metrics.count(name, value, normalizeOptions(tags));
};

export const distributionMetric = (name, value, tags) => {
  if (!hasMetricsApi()) return;
  Sentry.metrics.distribution(name, value, normalizeOptions(tags));
};
