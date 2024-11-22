import React, { useEffect, useState } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
    VSCodeProgressRing,
} from "@vscode/webview-ui-toolkit/react";
import { AuthState } from "../types";

interface AuthenticationStepProps {
    authState: AuthState;
    onAuthComplete: () => void;
    vscode: any;
}

export const AuthenticationStep: React.FC<AuthenticationStepProps> = ({
    authState,
    onAuthComplete,
    vscode,
}) => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [username, setUsername] = useState("");
    const [isRegistering, setIsRegistering] = useState(false);

    useEffect(() => {
        if (authState.isAuthenticated) {
            onAuthComplete();
        }
    }, [authState.isAuthenticated, onAuthComplete]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const command = isRegistering ? "auth.signup" : "auth.login";
        vscode.postMessage({
            command,
            email,
            password,
            ...(isRegistering ? { username } : {}),
        });
    };

    const handleLogin = () => {
        vscode.postMessage({
            command: "auth.status",
        });
    };

    if (!authState.isAuthExtensionInstalled) {
        return null;
    }

    if (authState.isLoading) {
        return (
            <div style={{ textAlign: "center", padding: "2rem" }}>
                <VSCodeProgressRing />
                <p>Checking authentication status...</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: "400px", margin: "0 auto", padding: "2rem" }}>
            <h2>{isRegistering ? "Create Account" : "Sign In"}</h2>
            <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: "1rem" }}>
                    <VSCodeTextField
                        type="text"
                        value={username}
                        onChange={(e) => setUsername((e.target as HTMLInputElement).value)}
                        placeholder="Username"
                        required
                    />
                </div>
                {isRegistering && (
                    <div style={{ marginBottom: "1rem" }}>
                        <VSCodeTextField
                            type="email"
                            value={email}
                            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                            placeholder="Email"
                            required
                        />
                    </div>
                )}
                <div style={{ marginBottom: "1rem" }}>
                    <VSCodeTextField
                        type="password"
                        value={password}
                        onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                        placeholder="Password"
                        required
                    />
                </div>
                {authState.error && (
                    <div style={{ color: "var(--vscode-errorForeground)", marginBottom: "1rem" }}>
                        {authState.error}
                    </div>
                )}
                <div style={{ display: "flex", gap: "1rem" }}>
                    <VSCodeButton type="submit">
                        {isRegistering ? "Sign Up" : "Sign In"}
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="secondary"
                        onClick={() => setIsRegistering(!isRegistering)}
                    >
                        {isRegistering ? "Already have an account?" : "Need an account?"}
                    </VSCodeButton>
                </div>
            </form>
        </div>
    );
};
