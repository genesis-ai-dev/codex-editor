import React from "react";
import { captureException } from "./posthog";

interface ErrorBoundaryProps {
    fallback?: React.ReactNode;
    children: React.ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        captureException(error, {
            source: "ReactErrorBoundary",
            componentStack: errorInfo.componentStack ?? "",
        });
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div
                    style={{
                        padding: "2rem",
                        textAlign: "center",
                        color: "var(--foreground, #ccc)",
                    }}
                >
                    <h2>Something went wrong</h2>
                    <p style={{ marginTop: "0.5rem", opacity: 0.7 }}>
                        An unexpected error occurred. Try reloading the panel.
                    </p>
                </div>
            );
        }

        return this.props.children;
    }
}
