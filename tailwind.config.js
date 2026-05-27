/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}"],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        montserrat: ['Montserrat', 'sans-serif'],
      },
      colors: {
        brand: {
          cobalt: '#0A4B8F',
          lightblue: '#4EA6E0',
          navy: '#1A202C',
        }
      }
    }
  },
  plugins: [],
}
