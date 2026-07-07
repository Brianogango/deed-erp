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
        // Self-hosted via next/font (app/fonts.ts) — the CSS variables are set
        // on <body> in app/layout.tsx, with system stacks as fallback.
        sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", "'Helvetica Neue'", 'Arial', 'system-ui', 'sans-serif'],
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

        // ── Deep Blue (#2563EB) — primary action colour ───────────────────
        primary: {
          50:  '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#2563EB',   // DEED Blue — buttons, links, accents
          600: '#1D4ED8',
          700: '#1A44C8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        // ── Deed Navy (#1A1F5E) — corporate anchor / sidebar ─────────────
        navy: {
          50:  '#F0F1FA',
          100: '#D0D3F0',
          200: '#9EA5DC',
          300: '#6C75C7',
          400: '#3A46B2',
          500: '#1A1F5E',   // Deed Navy — sidebar, headers
          600: '#161A50',
          700: '#111442',
          800: '#0C0F33',
          900: '#080A25',
        },
        accent: {
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#2563EB',   // alias to primary blue
          600: '#1D4ED8',
          700: '#1E40AF',
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
