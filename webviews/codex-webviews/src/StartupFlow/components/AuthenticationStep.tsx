import React, { useEffect, useState } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
    VSCodeProgressRing,
} from "@vscode/webview-ui-toolkit/react";
import { AuthState } from "../types";
import { MessagesToStartupFlowProvider, SourceUploadPostMessages } from "types";

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
    console.log("AuthenticationStep", { authState });
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [username, setUsername] = useState("");
    const [isRegistering, setIsRegistering] = useState(false);
    const [passwordError, setPasswordError] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (authState.isAuthenticated) {
            onAuthComplete();
            setIsLoading(false);
        }
    }, [authState.isAuthenticated, onAuthComplete]);

    const validatePassword = (password: string): boolean => {
        if (password.length < 10) {
            setPasswordError("Password must be at least 10 characters long");
            return false;
        }
        if (!/[A-Z]/.test(password)) {
            setPasswordError("Password must contain at least one capital letter");
            return false;
        }
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
            setPasswordError("Password must contain at least one special character");
            return false;
        }
        setPasswordError("");
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        const command = isRegistering ? "auth.signup" : "auth.login";

        if (isRegistering) {
            if (!validatePassword(password)) {
                return;
            }
            if (password !== confirmPassword) {
                setPasswordError("Passwords do not match");
                return;
            }
            vscode.postMessage({
                command,
                username,
                password,
                email,
            } as MessagesToStartupFlowProvider);
        } else {
            vscode.postMessage({
                command,
                username,
                password,
            } as MessagesToStartupFlowProvider);
        }
    };

    const handleLogin = () => {
        vscode.postMessage({
            command: "auth.status",
        });
    };

    if (!authState.isAuthExtensionInstalled) {
        return null;
    }

    if (isLoading) {
        return (
            <div style={{ textAlign: "center", padding: "2rem" }}>
                <VSCodeProgressRing />
                <p>Checking authentication status...</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: "300px", margin: "0 auto", padding: "2rem", width: "100%" }}>
            <div
                style={{
                    display: "flex",
                    gap: "1rem",
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    marginBottom: "1rem",
                }}
            >
                <VSCodeButton appearance="icon" onClick={() => setIsRegistering(!isRegistering)}>
                    {isRegistering ? "Already have an account?" : "Need an account?"}
                </VSCodeButton>
            </div>
            <h2 style={{ marginBottom: "1rem" }}>{isRegistering ? "Create Account" : "Sign In"}</h2>
            <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: "1rem" }}>
                    <VSCodeTextField
                        type="text"
                        value={username}
                        onChange={(e) => setUsername((e.target as HTMLInputElement).value)}
                        placeholder="Username"
                        required
                        style={{ width: "100%" }}
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
                            style={{ width: "100%" }}
                        />
                    </div>
                )}
                <div style={{ marginBottom: "1rem" }}>
                    <VSCodeTextField
                        type="password"
                        value={password}
                        onChange={(e) => {
                            const newPassword = (e.target as HTMLInputElement).value;
                            setPassword(newPassword);
                            if (isRegistering) {
                                validatePassword(newPassword);
                            }
                        }}
                        placeholder="Password"
                        required
                        style={{ width: "100%" }}
                    />
                </div>
                {isRegistering && (
                    <div style={{ marginBottom: "1rem" }}>
                        <VSCodeTextField
                            type="password"
                            value={confirmPassword}
                            onChange={(e) =>
                                setConfirmPassword((e.target as HTMLInputElement).value)
                            }
                            placeholder="Confirm Password"
                            required
                            style={{ width: "100%" }}
                        />
                    </div>
                )}
                {passwordError && (
                    <div style={{ color: "var(--vscode-errorForeground)", marginBottom: "1rem" }}>
                        {passwordError}
                    </div>
                )}
                {authState.error && (
                    <div style={{ color: "var(--vscode-errorForeground)", marginBottom: "1rem" }}>
                        {authState.error}
                    </div>
                )}
                <div
                    style={{
                        display: "flex",
                        gap: "1rem",
                        flexDirection: "column",
                        alignItems: "center",
                    }}
                >
                    <VSCodeButton type="submit">
                        {isRegistering ? "Sign Up" : "Sign In"}
                    </VSCodeButton>
                </div>
            </form>
        </div>
    );
};
