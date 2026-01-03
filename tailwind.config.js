/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-raleway)', 'Raleway', 'system-ui', 'sans-serif'],
        raleway: ['var(--font-raleway)', 'Raleway', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50: 'var(--color-primary-50, #EFF6FF)',
          100: 'var(--color-primary-100, #DBEAFE)',
          200: 'var(--color-primary-200, #BFDBFE)',
          300: 'var(--color-primary-300, #93C5FD)',
          400: 'var(--color-primary-400, #60A5FA)',
          500: 'var(--color-primary-500, #3B82F6)',
          600: 'var(--color-primary-600, #2563EB)',
          700: 'var(--color-primary-700, #1D4ED8)',
          800: 'var(--color-primary-800, #1E40AF)',
          900: 'var(--color-primary-900, #1E3A8A)',
        },
        secondary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        'theme-bg': {
          main: 'var(--color-bg-main, #F3F4F6)',
          card: 'var(--color-bg-card, #FFFFFF)',
          sidebar: 'var(--color-bg-sidebar, #FFFFFF)',
          hover: 'var(--color-bg-hover, #EFF6FF)',
        },
        'theme-text': {
          primary: 'var(--color-text-primary, #111827)',
          secondary: 'var(--color-text-secondary, #6B7280)',
        },
      },
      backgroundColor: {
        'theme-main': 'var(--color-bg-main, #F3F4F6)',
        'theme-card': 'var(--color-bg-card, #FFFFFF)',
        'theme-sidebar': 'var(--color-bg-sidebar, #FFFFFF)',
        'theme-hover': 'var(--color-bg-hover, #EFF6FF)',
      },
      zIndex: {
        'mira': '2147483647', // Maximum z-index for MIRA to appear above everything
      },
    },
  },
  plugins: [],
}

