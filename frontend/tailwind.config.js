/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#080B14',
          secondary: '#0D1117',
          card: '#0F1520',
          elevated: '#141C2B',
          border: '#1C2840',
        },
        accent: {
          cyan: '#00D4FF',
          green: '#00FF88',
          red: '#FF3D6B',
          yellow: '#FFB800',
          purple: '#8B5CF6',
          orange: '#FF6B35',
        },
        text: {
          primary: '#E8F0FF',
          secondary: '#7B8FAB',
          muted: '#3D4F6B',
        }
      },
      fontFamily: {
        display: ['Orbitron', 'monospace'],
        body: ['IBM Plex Mono', 'monospace'],
        sans: ['IBM Plex Sans', 'sans-serif'],
      },
      boxShadow: {
        'cyan-glow': '0 0 20px rgba(0, 212, 255, 0.15)',
        'green-glow': '0 0 20px rgba(0, 255, 136, 0.15)',
        'red-glow': '0 0 20px rgba(255, 61, 107, 0.15)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'scan': 'scan 4s linear infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'blink': 'blink 1.2s step-end infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' }
        },
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 }
        },
        slideUp: {
          from: { opacity: 0, transform: 'translateY(12px)' },
          to: { opacity: 1, transform: 'translateY(0)' }
        },
        blink: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0 }
        }
      }
    },
  },
  plugins: [],
}
