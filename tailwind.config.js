/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
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
        // Self-hosted via next/font (app/fonts.ts) — brand fonts per Deed Technologies guidelines.
        sans: ['var(--font-roboto-flex)', 'var(--font-open-sans)', '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'system-ui', 'sans-serif'],
        body: ['var(--font-open-sans)', '-apple-system', "'Segoe UI'", 'sans-serif'],
        mono: ['var(--font-dm-mono)', "'Cascadia Code'", 'ui-monospace', 'monospace'],
      },
      colors: {
        // ── Light mode page/surface tokens ──────────────────────────────
        bg:       '#F1F5F9',
        surface:  '#F8FAFC',
        panel:    '#E2E8F0',
        card:     '#FFFFFF',
        card2:    '#F8FAFC',
        muted:    '#EEF2F7',
        border:   '#CBD5E1',
        'border2':'#94A3B8',
        'border-lt': '#E2E8F0',
        t1:       '#0F172A',
        t2:       '#1E293B',
        t3:       '#475569',
        t4:       '#64748B',
        text: {
          1: 'var(--text-1)',
          2: 'var(--text-2)',
          3: 'var(--text-3)',
          4: 'var(--text-4)',
        },
        destructive: '#DC2626',

        // ── Deed Sky Blue (#00aeef) — primary action / brand accent ──────
        primary: {
          50:  '#e6f8fe',
          100: '#ccf1fd',
          200: '#99e3fb',
          300: '#66d4f8',
          400: '#33c0f3',
          500: '#00aeef',   // Deed Sky Blue — buttons, links, accents
          600: '#0096cc',
          700: '#007eaa',
          800: '#006688',
          900: '#004e66',
        },
        // ── Deed Navy / Valhalla (#20164d) — corporate anchor / sidebar ──
        navy: {
          50:  '#eeecf5',
          100: '#cdc8e6',
          200: '#9b91cd',
          300: '#6a5ab4',
          400: '#38239b',
          500: '#20164d',   // Valhalla — sidebar, headers
          600: '#18103a',
          700: '#100b27',
          800: '#080614',
          900: '#040308',
        },
        accent: {
          300: '#66d4f8',
          400: '#33c0f3',
          500: '#00aeef',   // alias to primary
          600: '#0096cc',
          700: '#007eaa',
        },

        // ── Neutral black / white ────────────────────────────────────────
        black:  '#0F172A',
        white:  '#FFFFFF',

        // ── Status badge colours ─────────────────────────────────────────
        green:  '#059669',
        amber:  '#D97706',
        purple: '#7C3AED',
        red:    '#DC2626',
        blue:   '#2563EB',
        pink:   '#DB2777',
        gray:   '#64748B',

        // ── Friendly ERP badge tones (design system) ─────────────────────
        sage:   '#065F46',
        coral:  '#991B1B',
        honey:  '#78350F',
        mist:   '#1E3A5F',
        stone:  '#44403C',
      },
      // Elevation + radius reference the CSS-variable design tokens in
      // globals.css so theme tuning happens in one place. Class names are
      // unchanged — only their computed values now come from tokens.
      boxShadow: {
        glass: 'var(--shadow-md)',
        '2xl': '0 20px 60px rgba(0,0,0,0.18)',
        card:  'var(--shadow-sm)',
        modal: 'var(--shadow-modal)',
        sm: '0 1px 3px rgba(0,0,0,0.08)',
      },
      borderRadius: {
        'token-sm': 'var(--radius-sm)',
        'token-md': 'var(--radius-md)',
        'token-lg': 'var(--radius-lg)',
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
