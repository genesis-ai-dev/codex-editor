import React, { useState, useEffect } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
    VSCodeProgressRing,
    VSCodeBadge,
} from "@vscode/webview-ui-toolkit/react";
import { LoginRegisterStepProps } from "../types";

export const LoginRegisterStep: React.FC<LoginRegisterStepProps> = ({
    // authState,
    onLogin,
    onRegister,
    onLogout,
    onSkip,
}) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [email, setEmail] = useState("");
    const [passwordError, setPasswordError] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [passwordStrength, setPasswordStrength] = useState(0);
    const [isPasswordFocused, setIsPasswordFocused] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    useEffect(() => {
        const handleOnlineStatusChange = () => {
            setIsOffline(!navigator.onLine);
        };

        window.addEventListener("online", handleOnlineStatusChange);
        window.addEventListener("offline", handleOnlineStatusChange);

        return () => {
            window.removeEventListener("online", handleOnlineStatusChange);
            window.removeEventListener("offline", handleOnlineStatusChange);
        };
    }, []);

    const validatePassword = (pass: string) => {
        if (pass.length < 16) {
            setPasswordError("Password must be at least 16 characters long");
            return false;
        } else if (pass.length > 16) {
            setPasswordError("");
            return true;
        }
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        const trimmedUsername = username.trim();
        const trimmedPassword = password;
        const trimmedEmail = email.trim();

        try {
            if (isRegistering) {
                if (!validatePassword(trimmedPassword)) {
                    setIsLoading(false);
                    return;
                }
                if (trimmedPassword !== confirmPassword) {
                    setPasswordError("Passwords do not match");
                    setIsLoading(false);
                    return;
                }
                setPasswordError("");

                // Await the promise resolution from the register API call
                const success = await onRegister(trimmedUsername, trimmedEmail, trimmedPassword);
                // Keep loading until promise resolves
            } else {
                // Await the promise resolution from the login API call
                const success = await onLogin(trimmedUsername, trimmedPassword);
                // Keep loading until promise resolves
            }
        } catch (error) {
            console.error("Authentication error:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newPassword = e.target.value;
        setPassword(newPassword);
        const strength = Math.min((newPassword.length / 16) * 100, 100);
        setPasswordStrength(strength);
    };

    const handleUsernameChange = (e: React.FormEvent<HTMLElement>) => {
        setUsername((e.target as HTMLInputElement).value);
    };

    const handleEmailChange = (e: React.FormEvent<HTMLElement>) => {
        setEmail((e.target as HTMLInputElement).value);
    };

    // if (authState.isAuthenticated) {
    //     return (
    //         <div className="login-register-step">
    //             <h2>Welcome, {authState.gitlabInfo?.username || "User"}!</h2>
    //             <VSCodeButton onClick={onLogout}>Logout</VSCodeButton>
    //             <VSCodeButton onClick={onSkip} appearance="icon">
    //                 <span
    //                     style={{
    //                         textDecoration: "underline",
    //                         width: "auto",
    //                         height: "auto",
    //                     }}
    //                 >
    //                     Back
    //                 </span>
    //             </VSCodeButton>
    //         </div>
    //     );
    // }

    const centerBumpValue = 2.5;

    return (
        <div className="login-register-step">
            {isOffline && (
                <div
                    style={{
                        position: "absolute",
                        top: "10px",
                        right: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        backgroundColor: "var(--vscode-badge-background)",
                        color: "var(--vscode-badge-foreground)",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                    }}
                >
                    <i className="codicon codicon-error"></i>
                    <span>Offline</span>
                </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                <VSCodeButton
                    onClick={() => setIsRegistering(!isRegistering)}
                    appearance="icon"
                    disabled={isLoading}
                >
                    <span style={{ textDecoration: "underline", width: "auto", height: "auto" }}>
                        {isRegistering ? "Back to Login" : "Create Account"}
                    </span>
                </VSCodeButton>
            </div>
            <h2>{isRegistering ? "Register" : "Login"}</h2>
            <form
                onSubmit={handleSubmit}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "1.5rem",
                    alignItems: "center",
                    width: "100%",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "1.5rem",
                        flexDirection: "column",
                        width: "min(100%, 400px)",
                    }}
                >
                    <VSCodeTextField
                        value={username}
                        onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
                        placeholder="Username"
                        required
                        style={{ width: "100%" }}
                        disabled={isLoading}
                    />
                    {isRegistering && (
                        <VSCodeTextField
                            type="email"
                            value={email}
                            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                            placeholder="Email"
                            required
                            style={{ width: "100%" }}
                            disabled={isLoading}
                        />
                    )}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            width: "100%",
                            position: "relative",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                                width: "100%",
                            }}
                        >
                            <VSCodeTextField
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onInput={(e) =>
                                    handlePasswordChange(e as React.ChangeEvent<HTMLInputElement>)
                                }
                                onFocus={() => setIsPasswordFocused(true)}
                                onBlur={() => setIsPasswordFocused(false)}
                                placeholder="Password"
                                required
                                style={{ width: "100%" }}
                                disabled={isLoading}
                            />
                            <VSCodeButton
                                appearance="icon"
                                onClick={() => setShowPassword(!showPassword)}
                                disabled={isLoading}
                            >
                                <i
                                    className={`codicon ${
                                        showPassword ? "codicon-eye" : "codicon-eye-closed"
                                    }`}
                                ></i>
                            </VSCodeButton>
                        </div>
                        {isRegistering && isPasswordFocused && (
                            <div
                                data-name="password-strength-indicator"
                                style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: "0",
                                    right: "0",
                                    background: "var(--vscode-menu-background)",
                                    border: "1px solid var(--vscode-menu-border)",
                                    borderRadius: "4px",
                                    padding: "8px",
                                    marginTop: "4px",
                                    zIndex: 1000,
                                    boxShadow: "0 2px 8px var(--vscode-widget-shadow)",
                                }}
                            >
                                <div
                                    style={{
                                        height: "4px",
                                        background: "var(--vscode-textBlockQuote-background)",
                                        borderRadius: "2px",
                                        overflow: "hidden",
                                        marginBottom: "8px",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${passwordStrength}%`,
                                            height: "100%",
                                            background: `${
                                                passwordStrength < 100
                                                    ? "var(--vscode-errorForeground)"
                                                    : "var(--vscode-testing-iconPassed)"
                                            }`,
                                            transition: "width 0.3s ease-in-out",
                                        }}
                                    />
                                </div>
                                <span
                                    style={{
                                        fontSize: "0.8em",
                                        color: "var(--vscode-descriptionForeground)",
                                    }}
                                >
                                    {password.length}/16 characters required
                                </span>
                            </div>
                        )}
                    </div>
                    {confirmPassword !== password && isRegistering && (
                        <span
                            style={{
                                color: "var(--vscode-errorForeground)",
                                fontSize: "1.5rem",
                                alignSelf: "center",
                            }}
                        >
                            ≠
                        </span>
                    )}
                    {isRegistering && (
                        <>
                            <VSCodeTextField
                                type={showPassword ? "text" : "password"}
                                value={confirmPassword}
                                onInput={(e) =>
                                    setConfirmPassword((e.target as HTMLInputElement).value)
                                }
                                placeholder="Confirm Password"
                                required
                                style={{ width: "100%" }}
                                disabled={isLoading}
                            />
                            {passwordError && (
                                <span style={{ color: "var(--vscode-errorForeground)" }}>
                                    {passwordError}
                                </span>
                            )}
                        </>
                    )}
                </div>
                <div
                    className="button-group"
                    style={{ display: "flex", alignItems: "center", gap: "1rem" }}
                >
                    <VSCodeButton type="submit" disabled={isLoading}>
                        {isLoading ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <VSCodeProgressRing />
                                <span>{isRegistering ? "Registering..." : "Logging in..."}</span>
                            </div>
                        ) : isRegistering ? (
                            "Register"
                        ) : (
                            "Login"
                        )}
                    </VSCodeButton>
                </div>
            </form>
        </div>
    );
};
