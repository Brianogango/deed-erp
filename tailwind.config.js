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
        sans: ['Trebuchet MS', 'Lucida Grande', 'Tahoma', 'Verdana', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // ── Light mode page/surface tokens ──────────────────────────────
        bg:       '#F4F6FA',
        surface:  '#F8F9FC',
        panel:    '#ECEEF6',
        card:     '#FFFFFF',
        card2:    '#F8F9FC',
        border:   '#DDE1EE',
        'border2':'#C8CCDF',
        'border-lt': '#ECEEF6',
        t1:       '#0A0B10',
        t2:       '#1A1F5E',
        t3:       '#5A6080',

        // ── Deed Cyan (#00AEEF) — primary action colour ──────────────────
        primary: {
          50:  '#E0F6FE',
          100: '#BAE9FC',
          200: '#7DD6F9',
          300: '#3DC3F6',
          400: '#15B8F2',
          500: '#00AEEF',   // Deed Cyan — buttons, links, accents
          600: '#0092CB',
          700: '#0077A7',
          800: '#005D84',
          900: '#004462',
        },
        // ── Deed Navy (#1A1F5E) — corporate anchor ───────────────────────
        navy: {
          50:  '#ECEDF8',
          100: '#C9CCEC',
          200: '#9398D5',
          300: '#5D64BD',
          400: '#3840A6',
          500: '#1A1F5E',   // Deed Navy — sidebar, headers, formal bg
          600: '#161A50',
          700: '#111442',
          800: '#0C0F33',
          900: '#080A25',
        },
        accent: {
          300: '#7DD6F9',
          400: '#15B8F2',
          500: '#00AEEF',   // alias to Deed Cyan
          600: '#0092CB',
          700: '#0077A7',
        },

        // ── Neutral black / white ────────────────────────────────────────
        black:  '#0A0B10',
        white:  '#FFFFFF',

        // ── Dark mode tokens ─────────────────────────────────────────────
        'dark-bg':      '#080A1A',
        'dark-card':    '#0F1228',
        'dark-panel':   '#151930',
        'dark-surface': '#1C2038',
        'dark-border':  '#2A2F58',
        'dark-t1':      '#F0F2FF',
        'dark-t2':      '#BCC3E8',
        'dark-t3':      '#7880B0',

        // ── Status badge colours ─────────────────────────────────────────
        green:  '#10B981',
        amber:  '#F59E0B',
        purple: '#8B5CF6',
        red:    '#EF4444',
        blue:   '#3B82F6',
        pink:   '#EC4899',
        gray:   '#6B7280',

        // ── Friendly ERP badge tones (design system) ─────────────────────
        sage:   '#3F6B2A',
        coral:  '#A14A33',
        honey:  '#8A6A1A',
        mist:   '#3F6478',
        stone:  '#5A5448',
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
