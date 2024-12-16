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

    const validatePassword = (pass: string) => {
        if (pass.length < 16) {
            setPasswordError("Password must be at least 16 characters long");
            return false;
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
                        marginRight: "-2.5rem",
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
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <VSCodeTextField
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e: any) => handlePasswordChange(e)}
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
                    {isRegistering && (
                        <>
                            <VSCodeTextField
                                type={showPassword ? "text" : "password"}
                                value={confirmPassword}
                                onChange={(e) =>
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
