/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0B0E11',
          secondary: '#12161C',
          card: '#12161C',
          elevated: '#161A1E',
          border: '#1E2329',
          hover: '#1E2329',
        },
        accent: {
          cyan: '#F0B90B',
          green: '#0ECB81',
          red: '#F6465D',
          yellow: '#F0B90B',
          purple: '#C99400',
          orange: '#F0B90B',
        },
        text: {
          primary: '#EAECEF',
          secondary: '#B7BDC6',
          muted: '#848E9C',
        }
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        body: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
