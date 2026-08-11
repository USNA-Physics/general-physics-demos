/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Official USNA palette (Pantone) — constant across themes
        'usna-navy': '#00205B',       // PMS 281 C
        'usna-gold': 'var(--color-gold)',
        'usna-gold-light': 'var(--color-gold-light)',

        // Semantic surface colors — swap between light and dark
        'usna-deep': 'var(--color-deep)',
        'usna-card': 'var(--color-card)',
        'usna-plot': '#0D1321',       // plots always dark
        'usna-text': 'var(--color-text)',
        'usna-muted': 'var(--color-muted)',
        'usna-grid': 'var(--color-grid)',
        'usna-zero': 'var(--color-zero)',

        // Semantic
        'usna-success': '#27AE60',
        'usna-warning': '#C5B783',
        'usna-error': '#C0392B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
