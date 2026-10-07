/** @type {import('tailwindcss').Config} */
module.exports = {
  // Scan every HTML and JS file in Frontend so unused classes get purged
  content: ['./Frontend/**/*.{html,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui'],
      },
    },
  },
  plugins: [],
};
