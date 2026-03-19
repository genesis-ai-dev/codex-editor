import posthog from "posthog-js";

interface PostHogConfig {
    token: string;
    host: string;
    distinctId: string;
    sessionRecordingEnabled: boolean;
}

const config = (window as any).__POSTHOG_CONFIG__ as PostHogConfig | undefined;

if (config?.token) {
    posthog.init(config.token, {
        api_host: config.host,
        autocapture: true,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: !config.sessionRecordingEnabled,
        session_recording: {
            maskAllInputs: false,
            maskTextSelector: ".ph-no-capture",
        },
        persistence: "localStorage",
    });

    if (config.distinctId) {
        posthog.identify(config.distinctId);
    }
}

export { posthog };
