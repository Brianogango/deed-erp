/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // ── Breakpoints ──────────────────────────────────────────────────────
      // Mobile-first (min-width): sm=480, md=768, lg=1024, xl=1280, 2xl=1536
      // Desktop-first caps (max-width): max-sm<480, max-md<768, max-lg<1024, max-xl<1280
      screens: {
        sm:       '480px',
        md:       '768px',
        lg:       '1024px',
        xl:       '1280px',
        '2xl':    '1536px',
        'max-sm': { max: '479px'  },
        'max-md': { max: '767px'  },
        'max-lg': { max: '1023px' },
        'max-xl': { max: '1279px' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        // ── Light mode page/surface tokens ──────────────────────────────
        bg:       '#F5F6FA',
        surface:  '#F9FAFB',
        panel:    '#F3F4F6',
        card:     '#FFFFFF',
        card2:    '#F9FAFB',
        border:   '#E5E7EB',
        'border2':'#D1D5DB',
        'border-lt': '#F3F4F6',
        t1:       '#111827',
        t2:       '#374151',
        t3:       '#6B7280',

        // ── Brand (primary = navy, accent = cyan) ───────────────────────
        primary: {
          50:  '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#1B2762',
          600: '#141D4D',
          700: '#0F1640',
          800: '#0A1030',
          900: '#060B22',
        },
        accent: {
          300: '#38BDF8',
          400: '#00B0D7',
          500: '#00B0D7',
          600: '#0090B0',
          700: '#007090',
        },

        // ── Dark mode tokens ─────────────────────────────────────────────
        'dark-bg':      '#090B12',
        'dark-card':    '#121521',
        'dark-panel':   '#1A1D27',
        'dark-surface': '#22263A',
        'dark-border':  '#2A2F40',
        'dark-t1':      '#F8FAFC',
        'dark-t2':      '#CBD5E1',
        'dark-t3':      '#94A3B8',

        // ── Status badge colours ─────────────────────────────────────────
        green:  '#10B981',
        amber:  '#F59E0B',
        purple: '#8B5CF6',
        red:    '#EF4444',
        blue:   '#3B82F6',
        pink:   '#EC4899',
        gray:   '#6B7280',
      },
      boxShadow: {
        glass: '0 4px 14px rgba(0,0,0,0.10)',
        '2xl': '0 20px 60px rgba(0,0,0,0.20)',
        card:  '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
        modal: '0 20px 60px rgba(0,0,0,0.20)',
      },
      backdropBlur: {
        xs: '2px',
      },
      spacing: {
        sidebar: '220px',
        'sidebar-sm': '56px',
        topbar: '56px',
      },
    },
  },
  plugins: [],
}
