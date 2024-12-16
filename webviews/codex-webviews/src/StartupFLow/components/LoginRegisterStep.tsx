import React, { useState } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { LoginRegisterStepProps } from "../types";

export const LoginRegisterStep: React.FC<LoginRegisterStepProps> = ({
    authState,
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isRegistering) {
            if (!validatePassword(password)) {
                return;
            }
            if (password !== confirmPassword) {
                setPasswordError("Passwords do not match");
                return;
            }
            setPasswordError("");
            onRegister(username, email, password);
        } else {
            onLogin(username, password);
        }
    };

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newPassword = e.target.value;
        setPassword(newPassword);
        const strength = Math.min((newPassword.length / 16) * 100, 100);
        setPasswordStrength(strength);
        if (isRegistering) {
            validatePassword(newPassword);
        }
    };

    if (authState.isAuthenticated) {
        return (
            <div className="login-register-step">
                <h2>Welcome, {authState.gitlabInfo?.username || "User"}!</h2>
                <VSCodeButton onClick={onLogout}>Logout</VSCodeButton>
                <VSCodeButton onClick={onSkip} appearance="icon">
                    <span
                        style={{
                            textDecoration: "underline",
                            width: "auto",
                            height: "auto",
                        }}
                    >
                        Back
                    </span>
                </VSCodeButton>
            </div>
        );
    }

    const centerBumpValue = 2.5;

    return (
        <div className="login-register-step">
            <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
                <VSCodeButton onClick={() => setIsRegistering(!isRegistering)} appearance="icon">
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
                    gap: "1rem",
                    alignItems: "center",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "start",
                        gap: "1rem",
                        flexDirection: "column",
                        marginRight: `-${centerBumpValue}rem`,
                    }}
                >
                    <VSCodeTextField
                        value={username}
                        onChange={(e) => setUsername((e.target as HTMLInputElement).value)}
                        placeholder="Username"
                        required
                    />
                    {isRegistering && (
                        <VSCodeTextField
                            type="email"
                            value={email}
                            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                            placeholder="Email"
                            required
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
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
                            />
                            <VSCodeButton
                                appearance="icon"
                                onClick={() => setShowPassword(!showPassword)}
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
                                                passwordStrength < 50
                                                    ? "var(--vscode-errorForeground)"
                                                    : passwordStrength < 100
                                                    ? "var(--vscode-warningForeground)"
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
                    {confirmPassword !== password && (
                        <span
                            style={{
                                color: "var(--vscode-errorForeground)",
                                fontSize: "1.5rem",
                                alignSelf: "center",
                                marginRight: `${centerBumpValue}rem`,
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
                            />
                            {passwordError && (
                                <span style={{ color: "var(--vscode-errorForeground)" }}>
                                    {passwordError}
                                </span>
                            )}
                        </>
                    )}
                </div>
                <div className="button-group">
                    <VSCodeButton type="submit">
                        {isRegistering ? "Register" : "Login"}
                    </VSCodeButton>
                    {!isRegistering && (
                        <VSCodeButton onClick={onSkip} appearance="icon">
                            <span
                                style={{
                                    textDecoration: "underline",
                                    width: "auto",
                                    height: "auto",
                                }}
                            >
                                Skip
                            </span>
                        </VSCodeButton>
                    )}
                </div>
            </form>
        </div>
    );
};
