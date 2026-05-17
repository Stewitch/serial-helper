/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "var(--color-surface)",
          alt: "var(--color-surface-alt)",
          hover: "var(--color-surface-hover)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
        },
        monitor: {
          rx: "var(--color-monitor-rx)",
          tx: "var(--color-monitor-tx)",
          timestamp: "var(--color-monitor-timestamp)",
          system: "var(--color-monitor-system)",
        },
        flash: {
          DEFAULT: "var(--color-flash)",
          success: "var(--color-flash-success)",
          error: "var(--color-flash-error)",
        },
      },
      fontFamily: {
        mono: ['"Cascadia Code"', '"JetBrains Mono"', '"Fira Code"', "Consolas", "monospace"],
        sans: ['"Inter"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
      fontSize: {
        "monitor": ["13px", "1.5"],
      },
    },
  },
  plugins: [],
};
