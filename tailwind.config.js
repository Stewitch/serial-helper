/** @type {import('tailwindcss').Config} */
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`;

// Root font size is the user's UI scale (default 14px), so rem sizes below
// are expressed against 14px: 0.857rem = 12px at default scale.
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        chrome: rgb("chrome"),
        base: rgb("base"),
        raised: rgb("raised"),
        line: { DEFAULT: rgb("line"), strong: rgb("line-strong") },
        ink: { DEFAULT: rgb("ink"), 2: rgb("ink-2"), 3: rgb("ink-3") },
        accent: { DEFAULT: rgb("accent"), hover: rgb("accent-hover"), ink: rgb("accent-ink") },
        rx: rgb("rx"),
        tx: rgb("tx"),
        ok: rgb("ok"),
        warn: rgb("warn"),
        err: rgb("err"),
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', '"Microsoft YaHei UI"', '"PingFang SC"', "system-ui", "sans-serif"],
        mono: ['"Cascadia Mono"', '"Cascadia Code"', "Consolas", '"Microsoft YaHei UI"', "monospace"],
      },
      fontSize: {
        "2xs": ["0.786rem", "1.4"], // 11px
        xs: ["0.857rem", "1.45"], // 12px
        sm: ["0.929rem", "1.5"], // 13px
        md: ["1rem", "1.5"], // 14px
        lg: ["1.143rem", "1.4"], // 16px
        xl: ["1.571rem", "1.2"], // 22px
      },
      borderRadius: {
        DEFAULT: "6px",
        md: "7px",
        lg: "8px",
      },
      boxShadow: {
        pop: "0 8px 24px rgb(0 0 0 / 0.28), 0 0 0 1px rgb(var(--line))",
      },
    },
  },
  plugins: [],
};
