/** @type {import('tailwindcss').Config} */
// const colors = require('tailwindcss/colors');

export default {
    content: ["./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            colors: {
                transparent: "transparent",
                current: "currentColor",
                primary: "#FF5500",
                "primary-50": "#E4F2FF",
                secondary: "#151515",
                success: "#05C715",
                error: "#FF1500",
                validation: "#FFE5E5",
                light: "#E4F1FF",
                dark: "#333333",
            },
            fontSize: {
                xxs: ".65rem",
            },
            height: {
                editor: "calc(-9rem + 100vh)",
                reference: "calc((-9.5rem + 100vh)/2)",
            },
        },
    },
    // eslint-disable-next-line no-undef
    plugins: [require("@tailwindcss/typography")],
    darkMode: ["selector", '[class="vscode-dark"]'],
};
