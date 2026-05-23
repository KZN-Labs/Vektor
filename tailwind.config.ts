import type { Config } from 'tailwindcss'

export default {
  content: ['./src/ui/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        surface: '#111118',
        border:  '#1e1e2e',
      },
    },
  },
  plugins: [],
} satisfies Config
