/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./src/NewSourceUploader/**/*.{ts,tsx}",
        "./src/CommentsView/**/*.{ts,tsx}",
        "./src/CodexCellEditor/**/*.{ts,tsx}",
        "./src/components/**/*.{ts,tsx}",
        "./src/lib/**/*.{ts,tsx}",
    ],
    // In Tailwind v4, theme configuration is primarily done in CSS
    // All your VSCode variable mappings are handled in tailwind.css
};
