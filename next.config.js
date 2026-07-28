/** @type {import('next').NextConfig} */
const isDevelopment = process.env.NODE_ENV === 'development'
const configuredBuildCpus = Number.parseInt(process.env.NEXT_BUILD_CPUS || '', 10)
const buildCpus = Number.isInteger(configuredBuildCpus) && configuredBuildCpus > 0
  ? configuredBuildCpus
  : undefined

const nextConfig = {
  // Keep development modules isolated from production output. Reusing the same
  // directory across `next dev` and `next build` can leave incompatible
  // Webpack factories behind and surface as `undefined.call` at runtime.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Use a distinct browser URL namespace in development so clients that
  // previously cached dev chunks as immutable cannot execute stale factories.
  assetPrefix: process.env.NEXT_ASSET_PREFIX || undefined,
  // Production optimizations
  poweredByHeader: false,
  // Multiple sibling projects share the parent directory. Keep file tracing
  // scoped to this application to avoid scanning unrelated workspaces.
  outputFileTracingRoot: __dirname,
  // Disable Next.js compression - nginx handles gzip in production.
  // Having both causes double-compression that corrupts CSS/JS responses.
  compress: false,

  reactStrictMode: false,

  // Transpile ESM packages
  transpilePackages: ['react-markdown'],

  // Exclude native ONNX runtime from server bundling (causes segfault on Alpine/musl)
  serverExternalPackages: ['onnxruntime-node', '@xenova/transformers'],

  // Increase body size limit for file uploads (10MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    optimizePackageImports: [
      'react-icons',
      'date-fns',
      'lodash',
      '@heroicons/react',
      'recharts',
      'lottie-react'
    ],
    // Use every available CPU by default. Memory-constrained builders can opt
    // into a lower limit with NEXT_BUILD_CPUS=2 (or another positive integer).
    ...(buildCpus ? { cpus: buildCpus } : {}),
  },

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Dev indicators configuration (Next.js 15 compatible)
  devIndicators: {
    position: 'bottom-right',
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  // Headers for caching strategy
  async headers() {
    // Inline the security headers (CSP/HSTS/X-Frame-Options/etc.) so Node 18+
    // works without ESM interop in next.config.js. Keep in sync with
    // lib/security/securityHeaders.js.
    const securityHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=(self), payment=(), usb=(), interest-cohort=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      { key: 'X-XSS-Protection', value: '0' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "img-src 'self' data: blob: https://ik.imagekit.io https://*.googleusercontent.com https://maps.googleapis.com https://maps.gstatic.com",
          "font-src 'self' data: https://fonts.gstatic.com",
          "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://ik.imagekit.io https://maps.googleapis.com https://maps.gstatic.com wss: ws:",
          "frame-src 'self' https://www.google.com https://maps.google.com",
          "media-src 'self' data: blob:",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          'upgrade-insecure-requests',
        ].join('; '),
      },
    ];

    return [
      {
        // Apply security headers to ALL routes
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Development chunk names are reusable and must never be cached as
        // immutable. Production chunks are content-hashed and safe to cache.
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: isDevelopment
              ? 'no-store, no-cache, must-revalidate'
              : 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Images - cache for 1 day
        source: '/_next/image/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        // Public static files (fonts, icons, etc.)
        source: '/public/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        // API routes - NO CACHING
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
        ],
      },
      {
        // Dashboard pages - short cache with revalidation to prevent white screen
        source: '/dashboard/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, must-revalidate',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
        ],
      },
    ];
  },

  async redirects() {
    return [
      {
        source: '/super-admin',
        destination: '/superadmin',
        permanent: true,
      },
      {
        source: '/super-admin/:path*',
        destination: '/superadmin/:path*',
        permanent: true,
      },
    ];
  },

  async rewrites() {
    return [
      {
        source: '/.well-known/assetlinks.json',
        destination: '/api/assetlinks',
      },
    ];
  },

  webpack: (config, { isServer }) => {
    config.module.rules.push({
      test: /\.(glb|gltf)$/,
      type: 'asset/resource',
    });

    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        moment: 'moment/moment.js',
      };
    }

    // Prevent onnxruntime-node native binary from being loaded server-side (segfaults on Alpine/musl)
    // The @xenova/transformers library is only used client-side for meeting transcription,
    // but Next.js SSR can still trigger native binary loading which crashes the process.
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'onnxruntime-node': false,
      };
      config.externals = config.externals || [];
      config.externals.push('onnxruntime-node');
    }

    // Exclude server-only packages from client bundle
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      child_process: false,
    };

    return config;
  },
};

module.exports = nextConfig;


// Injected content via Sentry wizard below

const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(module.exports, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "mw-futuretech",
  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: Boolean(process.env.SENTRY_AUTH_TOKEN),

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
