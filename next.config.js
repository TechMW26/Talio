/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production optimizations
  poweredByHeader: false, // Remove X-Powered-By header
  compress: true, // Enable gzip compression
  
  // Enable React strict mode for better debugging
  reactStrictMode: false, // Disable in prod for performance
  
  // Note: swcMinify is now default in Next.js 15+, no need to specify
  
  // Increase body size limit for file uploads (10MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Optimize package imports for faster builds
    optimizePackageImports: [
      'react-icons',
      'date-fns',
      'lodash',
      '@heroicons/react',
      'recharts',
      'lottie-react'
    ],
  },

  // Image optimization
  images: {
    domains: ['localhost'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    // Optimize image loading
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31536000, // Cache images for 1 year
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Dev indicators configuration (Next.js 15 compatible)
  devIndicators: {
    position: 'bottom-right',
  },

  // Skip ESLint checks during Docker build
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Skip TypeScript checks during Docker build
  typescript: {
    ignoreBuildErrors: true,
  },

  // Headers for NO CACHING (to prevent white screen issues)
  async headers() {
    return [
      {
        // ALL routes - NO CACHING
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
        ],
      },
      {
        // API routes - explicit no caching
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
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

  // Webpack optimizations
  webpack: (config, { isServer }) => {
    // Support for .glb files
    config.module.rules.push({
      test: /\.(glb|gltf)$/,
      type: 'asset/resource',
    });
    
    // Production optimizations
    if (!isServer) {
      // Reduce bundle size by excluding unused locales
      config.resolve.alias = {
        ...config.resolve.alias,
        // Exclude moment locales if used
        moment: 'moment/moment.js',
      };
    }
    
    return config;
  },
};

module.exports = nextConfig;
