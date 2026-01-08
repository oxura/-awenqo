/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"]
      },
      colors: {
        ink: "#0b0b0f",
        ember: "#ff6b35",
        mist: "#f5f3f0",
        neon: "#7bdff2",
        moss: "#7bd87b",
        blush: "#ff9a8b"
      },
      backgroundImage: {
        "hero-gradient": "radial-gradient(circle at top left, rgba(123,223,242,0.35), transparent 60%), radial-gradient(circle at bottom right, rgba(255,107,53,0.25), transparent 55%), linear-gradient(135deg, #0b0b0f, #1b1b22)"
      }
    }
  },
  plugins: []
};
