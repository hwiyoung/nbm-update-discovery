/** @type {import('tailwindcss').Config} */
// CLAUDE.md §5.1: extend 비움. Tailwind 기본 팔레트만 사용.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
