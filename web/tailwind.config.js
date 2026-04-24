/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'var(--bg-base)',
          raised: 'var(--bg-raised)',
          surface: 'var(--bg-surface)',
          hover: 'var(--bg-hover)',
          'accent-soft': 'var(--bg-accent-soft)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border-default)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hi: 'var(--accent-hi)',
          lo: 'var(--accent-lo)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', '-apple-system', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['var(--font-serif)', 'ui-serif', 'Iowan Old Style', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'SF Mono', 'ui-monospace', 'Menlo', 'monospace'],
      },
      fontSize: {
        xs: ['11px', '16px'],
        sm: ['13px', '20px'],
        base: ['15px', '24px'],
        lg: ['17px', '26px'],
        xl: ['22px', '30px'],
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '20px',
      },
      boxShadow: {
        pop: '0 1px 0 rgba(255,230,200,.02) inset, 0 6px 20px -8px rgba(0,0,0,.6)',
        modal: '0 24px 60px -16px rgba(0,0,0,.7), 0 0 0 1px var(--border-subtle)',
      },
      transitionDuration: {
        hover: '120ms',
        enter: '180ms',
        modal: '220ms',
        exit: '140ms',
        mode: '240ms',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.22, 1, .36, 1)',
        spring: 'cubic-bezier(.34, 1.56, .64, 1)',
        soft: 'cubic-bezier(.4, 0, .2, 1)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'backdrop-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'modal-in': {
          '0%': { opacity: '0', transform: 'scale(.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'toast-in': {
          '0%': { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        'pulse-soft': {
          '0%, 100%': { boxShadow: '0 0 0 3px rgba(212,169,94,.08)' },
          '50%':      { boxShadow: '0 0 0 6px rgba(212,169,94,.18)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 180ms cubic-bezier(.22, 1, .36, 1)',
        'backdrop-in': 'backdrop-in 180ms cubic-bezier(.22, 1, .36, 1)',
        'modal-in': 'modal-in 220ms cubic-bezier(.34, 1.56, .64, 1)',
        'toast-in': 'toast-in 180ms cubic-bezier(.22, 1, .36, 1)',
        blink: 'blink 1.1s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
