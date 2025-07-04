import { useState, useEffect, useCallback, useRef } from "react";
import { ActivationTiming } from "../types";
import { getVSCodeAPI } from "../../shared/vscodeApi";

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

    // Initialize VS Code API only once using the safe shared function
    useEffect(() => {
        // Only initialize once
        if (vscodeRef.current === null) {
            try {
                // Use the shared safe VSCode API getter
                vscodeRef.current = getVSCodeAPI() as VSCodeAPISimple;
            } catch (error) {
                console.error("Failed to acquire VS Code API", error);
                // getVSCodeAPI already provides a safe fallback, so this should rarely happen
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
        try {
            if (vscodeRef.current && vscodeRef.current.postMessage) {
            vscodeRef.current.postMessage(message);
        } else if (window.parent !== window) {
            // Fallback: try to post message to parent window
            window.parent.postMessage(message, "*");
            } else {
                console.warn("No VSCode API available and no parent window - message not sent:", message);
            }
        } catch (error) {
            console.error("Failed to send message to VSCode:", error, message);
        }
    }, []);

    // Method to notify extension that animation is complete
    const notifyAnimationComplete = useCallback(() => {
        try {
        // Try to send via VSCode API first
            if (vscodeRef.current && vscodeRef.current.postMessage) {
            vscodeRef.current.postMessage({ command: "animationComplete" });
        } else {
            // Fallback: dispatch a custom event
            window.dispatchEvent(new CustomEvent("animation-complete"));
            }
        } catch (error) {
            console.error("Failed to notify animation complete:", error);
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
