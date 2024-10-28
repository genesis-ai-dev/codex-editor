export default function debug(...args: any[]) {
    // @ts-expect-error: process.env is not defined in the webview
    if (process.env.NODE_ENV !== "production") {
        console.debug("QuillSpellChecker", ...args);
    }
}
