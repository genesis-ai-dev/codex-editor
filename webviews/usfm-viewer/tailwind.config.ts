// tailwind.config.js

import defaultTheme from "tailwindcss/defaultTheme";
// import colors from 'tailwindcss/colors';
import type { Config } from "tailwindcss";

export default {
    content: ["./src/**/*.{js,jsx,ts,tsx}"],
    theme: {
        colors: {
            transparent: "transparent",
            current: "currentColor",
            primary: "#FF5500",
            "primary-50": "#E4F2FF",
            secondary: "#151515",
            success: "#05C715",
            error: "#FF1500",
            validation: "#FFE5E5",
            // white: colors.white,
            light: "#E4F1FF",
            // gray: colors.slate,
            dark: "#333333",
            // black: colors.black,
            // green: colors.emerald,
            // yellow: colors.amber,
            // red: colors.red,
        },
        extend: {
            fontSize: {
                xxs: ".65rem",
            },
            fontFamily: {
                sans: ["Inter var", ...defaultTheme.fontFamily.sans],
            },
            height: {
                editor: "calc(-9rem + 100vh)",
                "audio-editor": "calc(-6.5rem + 100vh)",
            },
        },
    },
    plugins: [require("@tailwindcss/typography")],
} satisfies Config;
