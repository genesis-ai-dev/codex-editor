import { useState, useEffect, useCallback, useRef } from "react";
import { ActivationTiming } from "../types";

// Define a simplified VSCodeAPI interface that matches what we actually use
interface VSCodeAPISimple {
    postMessage(message: any): void;
}

export interface SyncDetails {
    progress: number;
    message: string;
    currentFile?: string;
}

export interface VSCodeMessagingResult {
    timings: ActivationTiming[];
    isComplete: boolean;
    sendMessage: (message: any) => void;
    syncDetails?: SyncDetails;
}

export function useVSCodeMessaging(): VSCodeMessagingResult {
    // Start with any initial timing data provided by the window
    const initialTimings = window.initialState?.timings || [];
    const [timings, setTimings] = useState<ActivationTiming[]>(initialTimings);
    const [isComplete, setIsComplete] = useState(false);
    const [syncDetails, setSyncDetails] = useState<SyncDetails | undefined>(undefined);
    const vscodeRef = useRef<VSCodeAPISimple | null>(null);

    // Initialize VS Code API only once
    useEffect(() => {
        // Only initialize once
        if (vscodeRef.current === null) {
            try {
                // Access the VSCode API provided by the host
                if (typeof acquireVsCodeApi === "function") {
                    // We only need the postMessage method
                    vscodeRef.current = acquireVsCodeApi() as VSCodeAPISimple;
                }
            } catch (error) {
                console.error("Failed to acquire VS Code API", error);
            }
        }

        // Listen for custom vscode-message events
        const handleVSCodeMessage = (event: Event) => {
            const customEvent = event as CustomEvent;
            const message = customEvent.detail;

            if (message) {
                switch (message.command) {
                    case "update":
                        if (Array.isArray(message.timings)) {
                            setTimings(message.timings);
                        }
                        break;
                    case "complete":
                        setIsComplete(true);
                        break;
                    case "syncUpdate":
                        if (message.syncDetails) {
                            setSyncDetails(message.syncDetails);
                        }
                        break;
                }
            }
        };

        // Add event listener to the root element
        const rootElement = document.getElementById("root");
        if (rootElement) {
            rootElement.addEventListener("vscode-message", handleVSCodeMessage);
        }

        // Clean up the listener
        return () => {
            if (rootElement) {
                rootElement.removeEventListener("vscode-message", handleVSCodeMessage);
            }
        };
    }, []);

    // Also listen for regular window messages for compatibility
    useEffect(() => {
        const handleWindowMessage = (event: MessageEvent) => {
            const message = event.data;

            if (message) {
                switch (message.command) {
                    case "update":
                        if (Array.isArray(message.timings)) {
                            setTimings(message.timings);
                        }
                        break;
                    case "complete":
                        setIsComplete(true);
                        break;
                    case "syncUpdate":
                        if (message.syncDetails) {
                            setSyncDetails(message.syncDetails);
                        }
                        break;
                }
            }
        };

        window.addEventListener("message", handleWindowMessage);
        return () => window.removeEventListener("message", handleWindowMessage);
    }, []);

    const sendMessage = useCallback((message: any) => {
        if (vscodeRef.current) {
            vscodeRef.current.postMessage(message);
        } else if (window.parent !== window) {
            // Fallback: try to post message to parent window
            window.parent.postMessage(message, "*");
        }
    }, []);

    // Method to notify extension that animation is complete
    const notifyAnimationComplete = useCallback(() => {
        // Try to send via VSCode API first
        if (vscodeRef.current) {
            vscodeRef.current.postMessage({ command: "animationComplete" });
        } else {
            // Fallback: dispatch a custom event
            window.dispatchEvent(new CustomEvent("animation-complete"));
        }
    }, []);

    // When isComplete becomes true, trigger animation completion after delay
    useEffect(() => {
        if (isComplete) {
            // After animation is done (with more generous delay), notify extension
            const timeoutId = setTimeout(() => {
                notifyAnimationComplete();
            }, 5000); // Give animations and fade-out more time to play

            return () => clearTimeout(timeoutId);
        }
    }, [isComplete, notifyAnimationComplete]);

    return { timings, isComplete, sendMessage, syncDetails };
}
