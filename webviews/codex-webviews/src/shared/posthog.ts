import posthog from "posthog-js";

interface PostHogConfig {
    token: string;
    host: string;
    distinctId: string;
    enableRecording: boolean;
}

const config = (window as any).__POSTHOG_CONFIG__ as PostHogConfig | undefined;

if (config?.token) {
    posthog.init(config.token, {
        api_host: config.host,
        autocapture: false,
        rageclick: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: !config.enableRecording,
        session_recording: {
            maskAllInputs: false,
            maskTextSelector: ".ph-no-capture",
            collectFonts: false,
            recordCrossOriginIframes: false,
        },
        persistence: "localStorage",
    });

    if (config.distinctId) {
        posthog.identify(config.distinctId);
    }
}

export const captureException = (
    error: Error | unknown,
    context?: Record<string, string>
): void => {
    if (!config?.token) {
        return;
    }

    const err = error instanceof Error ? error : new Error(String(error));
    posthog.captureException(err, context);
};

window.addEventListener("error", (event) => {
    captureException(event.error ?? event.message, {
        source: "window.onerror",
        filename: event.filename ?? "",
        lineno: String(event.lineno ?? ""),
        colno: String(event.colno ?? ""),
    });
});

window.addEventListener("unhandledrejection", (event) => {
    captureException(event.reason, { source: "unhandledrejection" });
});

export { posthog };
