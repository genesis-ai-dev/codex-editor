import React, { useState, useEffect } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
    VSCodeProgressRing,
    VSCodeBadge,
} from "@vscode/webview-ui-toolkit/react";
import { LoginRegisterStepProps } from "../types";
import {
    PasswordDotsIndicator,
    validateVisualPassword,
} from "../../components/PasswordDotsIndicator";
import { MessagesToStartupFlowProvider } from "../../../../../types";

// Email Display Indicator Component with ghost template
const EmailDisplayIndicator: React.FC<{
    email: string;
    invalidPositions: number[];
    showIndicator: boolean;
}> = ({ email, invalidPositions, showIndicator }) => {
    if (!showIndicator) {
        return null;
    }

    // Determine which segments are valid for green coloring
    const getSegmentValidation = (inputEmail: string) => {
        const atIndex = inputEmail.indexOf("@");
        const segments = {
            localValid: false,
            atValid: false,
            dotValid: false,
            domainPreValid: false,
            domainPostValid: false,
        };

        if (atIndex === -1) {
            // Before @ is typed, nothing should be green
            return segments;
        }

        // We have an @ symbol
        segments.atValid = (inputEmail.match(/@/g) || []).length === 1;

        const localPart = inputEmail.substring(0, atIndex);
        const domainPart = inputEmail.substring(atIndex + 1);

        // Validate local part - only green once @ is typed
        if (localPart.length > 0) {
            const hasValidChars = /^[a-zA-Z0-9.\-_+]+$/.test(localPart);
            const specialChars = [".", "-", "_", "+"];

            // Check no consecutive special characters
            let hasConsecutiveSpecial = false;
            for (let i = 0; i < localPart.length - 1; i++) {
                if (
                    specialChars.includes(localPart[i]) &&
                    specialChars.includes(localPart[i + 1])
                ) {
                    hasConsecutiveSpecial = true;
                    break;
                }
            }

            // Check start/end restrictions
            const startsWithSpecial = specialChars.some((char) => localPart.startsWith(char));
            const endsWithSpecial = specialChars.some((char) => localPart.endsWith(char));

            segments.localValid =
                hasValidChars &&
                !hasConsecutiveSpecial &&
                !startsWithSpecial &&
                !endsWithSpecial &&
                localPart.length <= 64;
        }

        // Validate domain parts
        const firstDotIndex = domainPart.indexOf(".");
        if (firstDotIndex >= 0) {
            // We have a dot in domain
            segments.dotValid = true; // The dot itself is valid when present

            const domainPreDot = domainPart.substring(0, firstDotIndex);
            const domainPostDot = domainPart.substring(firstDotIndex + 1);

            // Domain pre-dot validation - only green once dot is typed
            if (firstDotIndex > 0) {
                const hasValidDomainChars = /^[a-zA-Z0-9-]+$/.test(domainPreDot);
                const noConsecutiveHyphens = !domainPreDot.includes("--");
                const noStartHyphen = !domainPreDot.startsWith("-");
                const noEndHyphen = !domainPreDot.endsWith("-");
                segments.domainPreValid =
                    hasValidDomainChars &&
                    noConsecutiveHyphens &&
                    noStartHyphen &&
                    noEndHyphen &&
                    domainPreDot.length > 0 &&
                    domainPreDot.length <= 63;
            }

            // Domain post-dot validation - handle multi-part domains/TLDs
            if (domainPostDot.length >= 2) {
                // Check if this is a simple TLD (letters only) or multi-part domain
                const domainParts = domainPostDot.split(".");

                if (domainParts.length === 1) {
                    // Simple TLD case (e.g., "com", "org")
                    const hasValidTLDChars = /^[a-zA-Z]+$/.test(domainPostDot);
                    segments.domainPostValid = hasValidTLDChars;
                } else {
                    // Multi-part domain case (e.g., "co.uk", "example.com")
                    let allPartsValid = true;

                    for (let i = 0; i < domainParts.length; i++) {
                        const part = domainParts[i];
                        if (!part || part.length === 0) {
                            allPartsValid = false;
                            break;
                        }

                        if (i === domainParts.length - 1) {
                            // Last part is TLD - should be letters only
                            if (!/^[a-zA-Z]+$/.test(part) || part.length < 2) {
                                allPartsValid = false;
                                break;
                            }
                        } else {
                            // Intermediate parts - can have alphanumeric + hyphens
                            const hasValidChars = /^[a-zA-Z0-9-]+$/.test(part);
                            const noConsecutiveHyphens = !part.includes("--");
                            const noStartHyphen = !part.startsWith("-");
                            const noEndHyphen = !part.endsWith("-");

                            if (
                                !hasValidChars ||
                                noConsecutiveHyphens === false ||
                                noStartHyphen === false ||
                                noEndHyphen === false ||
                                part.length > 63
                            ) {
                                allPartsValid = false;
                                break;
                            }
                        }
                    }

                    segments.domainPostValid = allPartsValid;
                }
            }
        }

        return segments;
    };

    const segmentValidation = getSegmentValidation(email);

    // Create ghost template display
    const createGhostTemplate = (inputEmail: string) => {
        if (!inputEmail) {
            // Show initial template with dots
            return "•@•.••";
        }

        // Find @ position
        const atIndex = inputEmail.indexOf("@");

        if (atIndex === -1) {
            // No @ found yet - show user input + template remainder
            // Make sure the template shifts as user types
            const localPart = inputEmail;
            const localDisplay = localPart.length > 0 ? localPart : "•";
            return localDisplay + "@•.••";
        }

        const localPart = inputEmail.substring(0, atIndex);
        const domainPart = inputEmail.substring(atIndex + 1);

        // Build local part (before @)
        let localDisplay = localPart || "•";
        if (localPart.length === 0) {
            localDisplay = "•";
        }

        // Find first dot in domain part
        const firstDotIndex = domainPart.indexOf(".");

        if (firstDotIndex === -1) {
            // No dot in domain yet
            let domainDisplay = domainPart || "•";
            if (domainPart.length === 0) {
                domainDisplay = "•";
            }
            return localDisplay + "@" + domainDisplay + ".••";
        }

        // Domain has a dot
        const domainPreDot = domainPart.substring(0, firstDotIndex);
        const domainPostDot = domainPart.substring(firstDotIndex + 1);

        let domainPreDisplay = domainPreDot || "•";
        if (domainPreDot.length === 0) {
            domainPreDisplay = "•";
        }

        let domainPostDisplay = domainPostDot || "••";
        if (domainPostDot.length === 0) {
            domainPostDisplay = "••";
        } else {
            // Check if we have multiple parts in post-dot (e.g., "co.uk" or "co.u")
            const postDotParts = domainPostDot.split(".");
            const lastPart = postDotParts[postDotParts.length - 1];

            if (lastPart.length < 2) {
                // TLD is too short, add ghost dots to indicate missing characters
                const dotsNeeded = 2 - lastPart.length;
                domainPostDisplay = domainPostDot + "•".repeat(dotsNeeded);
            } else {
                domainPostDisplay = domainPostDot;
            }
        }

        return localDisplay + "@" + domainPreDisplay + "." + domainPostDisplay;
    };

    const displayText = createGhostTemplate(email);

    return (
        <div
            style={{
                marginTop: "-8px",
                marginBottom: "4px",
                fontSize: "0.85em",
                fontFamily: "monospace",
                textAlign: "left",
                alignSelf: "flex-start",
                width: "100%",
                wordBreak: "break-all",
            }}
        >
            {displayText.split("").map((char, index) => {
                const isUserInput = index < email.length;
                const isInvalidPosition = invalidPositions.includes(index);
                const isDot = char === "•";

                // Determine if this character is in a valid segment
                const atPosition = displayText.indexOf("@");
                const firstDotPosition = displayText.indexOf(".", atPosition + 1);

                let isValidSegment = false;
                if (index < atPosition) {
                    // Local part - only green once @ is typed
                    isValidSegment = segmentValidation.localValid && isUserInput;
                } else if (index === atPosition) {
                    // @ symbol
                    isValidSegment = segmentValidation.atValid;
                } else if (
                    displayText[index] === "." &&
                    firstDotPosition >= 0 &&
                    index >= firstDotPosition
                ) {
                    // Any dot in domain (including multi-part domains)
                    isValidSegment = segmentValidation.dotValid;
                } else if (
                    index > atPosition &&
                    (firstDotPosition === -1 || index < firstDotPosition)
                ) {
                    // Domain pre-dot - only green once dot is typed
                    isValidSegment = segmentValidation.domainPreValid && isUserInput;
                } else if (firstDotPosition >= 0 && index > firstDotPosition) {
                    // Domain post-dot (including multi-part TLDs) - green when valid
                    isValidSegment = segmentValidation.domainPostValid && isUserInput;
                }

                return (
                    <span
                        key={index}
                        style={{
                            backgroundColor: isInvalidPosition
                                ? "var(--vscode-inputValidation-errorBackground)"
                                : "transparent",
                            color: isInvalidPosition
                                ? "var(--vscode-inputValidation-errorForeground)"
                                : isValidSegment
                                ? "var(--vscode-charts-green)"
                                : isDot
                                ? "var(--vscode-descriptionForeground)"
                                : isUserInput
                                ? "var(--vscode-foreground)"
                                : "var(--vscode-descriptionForeground)",
                            opacity: isDot ? 0.5 : 1,
                            padding: "1px",
                            borderRadius: "2px",
                        }}
                    >
                        {char}
                    </span>
                );
            })}
        </div>
    );
};

export const LoginRegisterStep: React.FC<LoginRegisterStepProps> = ({
    authState,
    vscode,
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
    const [emailErrors, setEmailErrors] = useState<string[]>([]);
    const [emailInvalidPositions, setEmailInvalidPositions] = useState<number[]>([]);
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [authError, setAuthError] = useState<string | null>(null);
    const [isForgettingPassword, setIsForgettingPassword] = useState(false);
    // const [resetEmail, setResetEmail] = useState("");
    const [resetEmailComplete, setResetEmailComplete] = useState(false);
    const [resetEmailErrorMessage, setResetEmailErrorMessage] = useState<string | null>(null);

    const isMissingExtension =
        authState !== undefined && !authState.isLoading && !authState.isAuthExtensionInstalled;

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

    // Listen for password reset responses
    useEffect(() => {
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "passwordReset.success") {
                setResetEmailComplete(true);
                // setResetEmail("");
                setResetEmailErrorMessage(null);
                setIsLoading(false);
            } else if (message.command === "passwordReset.error") {
                setResetEmailErrorMessage(
                    message.error || "An error occurred while requesting password reset"
                );
                setIsLoading(false);
            }
        };

        window.addEventListener("message", messageHandler);
        return () => {
            window.removeEventListener("message", messageHandler);
        };
    }, []);

    const validateEmail = (emailAddress: string) => {
        const trimmedEmail = emailAddress.trim();
        const errors: string[] = [];
        const invalidPositions: number[] = [];

        if (!trimmedEmail) {
            setEmailErrors(["Email is required"]);
            setEmailInvalidPositions([]);
            return false;
        }

        // Check for length first
        if (trimmedEmail.length > 254) {
            errors.push("Email address is too long (max 254 characters)");
        }

        // Check for invalid characters and track their positions
        for (let i = 0; i < trimmedEmail.length; i++) {
            const char = trimmedEmail[i];
            // Allow alphanumeric, periods, hyphens, underscores, plus signs, and @
            if (!/[a-zA-Z0-9.\-_+@]/.test(char)) {
                invalidPositions.push(i);
            }
        }

        if (invalidPositions.length > 0) {
            const invalidChars = invalidPositions.map((pos) => trimmedEmail[pos]);
            const uniqueInvalidChars = [...new Set(invalidChars)];
            errors.push(`Invalid characters found: ${uniqueInvalidChars.join(", ")}`);
        }

        // Check for exactly one @ symbol
        const atCount = (trimmedEmail.match(/@/g) || []).length;
        const allInvalidPositions = [...invalidPositions];

        if (atCount === 0) {
            errors.push("Email must contain an @ symbol");
        } else if (atCount > 1) {
            // Find positions of extra @ symbols (keep first one, mark others as invalid)
            const atPositions: number[] = [];
            for (let i = 0; i < trimmedEmail.length; i++) {
                if (trimmedEmail[i] === "@") {
                    atPositions.push(i);
                }
            }
            errors.push("Email can only contain one @ symbol");
            allInvalidPositions.push(...atPositions.slice(1)); // Mark all but first @ as invalid
        }

        // If we have exactly one @, validate domain-specific character restrictions
        if (atCount === 1) {
            const atIndex = trimmedEmail.indexOf("@");
            const domainPart = trimmedEmail.substring(atIndex + 1);

            // Check for characters that are valid in local part but not in domain
            const domainInvalidChars: string[] = [];
            for (let i = 0; i < domainPart.length; i++) {
                const char = domainPart[i];
                if (/[+_]/.test(char)) {
                    // + and _ are not allowed in domain part
                    allInvalidPositions.push(atIndex + 1 + i);
                    if (!domainInvalidChars.includes(char)) {
                        domainInvalidChars.push(char);
                    }
                }
            }

            if (domainInvalidChars.length > 0) {
                errors.push(
                    `Characters ${domainInvalidChars.join(", ")} are not allowed in domain`
                );
            }
        }

        // Only continue detailed validation if we have exactly one @
        if (atCount === 1) {
            // Split into local and domain parts
            const atIndex = trimmedEmail.indexOf("@");
            const localPart = trimmedEmail.substring(0, atIndex);
            const domainPart = trimmedEmail.substring(atIndex + 1);

            // Validate local part (before @)
            if (!localPart) {
                errors.push("Email cannot start with @");
                allInvalidPositions.push(0);
            } else {
                if (localPart.length > 64) {
                    errors.push("Part before @ is too long (max 64 characters)");
                }

                // Check start/end restrictions for special characters
                const specialChars = [".", "-", "_", "+"];
                for (const char of specialChars) {
                    if (localPart.startsWith(char)) {
                        errors.push(`Email cannot start with ${char}`);
                        allInvalidPositions.push(0);
                    }
                    if (localPart.endsWith(char)) {
                        errors.push(`Part before @ cannot end with ${char}`);
                        allInvalidPositions.push(atIndex - 1);
                    }
                }

                // Check for consecutive special characters in local part
                for (let i = 0; i < localPart.length - 1; i++) {
                    const char1 = localPart[i];
                    const char2 = localPart[i + 1];

                    if (specialChars.includes(char1) && specialChars.includes(char2)) {
                        // Find all consecutive special characters in this sequence
                        let j = i;
                        const consecutiveSpecial: number[] = [];
                        while (j < localPart.length && specialChars.includes(localPart[j])) {
                            consecutiveSpecial.push(j);
                            j++;
                        }
                        allInvalidPositions.push(...consecutiveSpecial);
                        errors.push("Part before @ cannot contain consecutive special characters");
                        i = j - 1; // Skip ahead to avoid duplicate detection
                    }
                }
            }

            // Validate domain part (after @)
            if (!domainPart) {
                // Don't add redundant error - this is covered by "Domain must contain at least one dot"
            } else {
                if (domainPart.length > 253) {
                    errors.push("Domain part is too long (max 253 characters)");
                }

                const startsWithDot = domainPart.startsWith(".");
                const endsWithDot = domainPart.endsWith(".");

                if (startsWithDot) {
                    errors.push("Domain cannot start with a dot");
                    allInvalidPositions.push(atIndex + 1);
                }
                if (endsWithDot) {
                    errors.push("Domain cannot end with a dot");
                    allInvalidPositions.push(trimmedEmail.length - 1);
                }

                // Check for consecutive dots in domain part
                for (let i = 0; i < domainPart.length - 1; i++) {
                    if (domainPart[i] === "." && domainPart[i + 1] === ".") {
                        // Find all consecutive dots in this sequence
                        let j = i;
                        const consecutiveDots: number[] = [];
                        while (j < domainPart.length && domainPart[j] === ".") {
                            consecutiveDots.push(atIndex + 1 + j);
                            j++;
                        }
                        allInvalidPositions.push(...consecutiveDots);
                        errors.push("Domain cannot contain consecutive dots");
                        i = j - 1; // Skip ahead to avoid duplicate detection
                    }
                }

                // Check for consecutive hyphens in domain part
                for (let i = 0; i < domainPart.length - 1; i++) {
                    if (domainPart[i] === "-" && domainPart[i + 1] === "-") {
                        // Find all consecutive hyphens in this sequence
                        let j = i;
                        const consecutiveHyphens: number[] = [];
                        while (j < domainPart.length && domainPart[j] === "-") {
                            consecutiveHyphens.push(atIndex + 1 + j);
                            j++;
                        }
                        allInvalidPositions.push(...consecutiveHyphens);
                        errors.push("Domain cannot contain consecutive hyphens");
                        i = j - 1; // Skip ahead to avoid duplicate detection
                    }
                }

                if (!domainPart.includes(".")) {
                    errors.push("Domain must contain at least one dot");
                } else {
                    // Check domain parts (separated by dots) - but only if we don't have start/end dot issues
                    if (!startsWithDot && !endsWithDot) {
                        const domainParts = domainPart.split(".");
                        for (let i = 0; i < domainParts.length; i++) {
                            const part = domainParts[i];
                            if (!part) {
                                errors.push("Domain cannot have empty parts between dots");
                                break; // Only report this once
                            } else if (part.length > 63) {
                                errors.push(
                                    `Domain part "${part}" is too long (max 63 characters)`
                                );
                            } else {
                                // Check hyphen rules for each domain part
                                if (part.startsWith("-")) {
                                    errors.push("Domain parts cannot start with hyphen");
                                    // Find position of this hyphen
                                    let partStart = atIndex + 1;
                                    for (let k = 0; k < i; k++) {
                                        partStart += domainParts[k].length + 1; // +1 for the dot
                                    }
                                    allInvalidPositions.push(partStart);
                                }
                                if (part.endsWith("-")) {
                                    errors.push("Domain parts cannot end with hyphen");
                                    // Find position of this hyphen
                                    let partStart = atIndex + 1;
                                    for (let k = 0; k < i; k++) {
                                        partStart += domainParts[k].length + 1; // +1 for the dot
                                    }
                                    allInvalidPositions.push(partStart + part.length - 1);
                                }

                                // Validate domain part characters (alphanumeric + hyphens only)
                                if (!/^[a-zA-Z0-9-]+$/.test(part)) {
                                    errors.push(
                                        "Domain parts can only contain letters, numbers, and hyphens"
                                    );

                                    // Find and mark invalid characters in this domain part
                                    let partStart = atIndex + 1;
                                    for (let k = 0; k < i; k++) {
                                        partStart += domainParts[k].length + 1; // +1 for the dot
                                    }

                                    for (let charIndex = 0; charIndex < part.length; charIndex++) {
                                        const char = part[charIndex];
                                        if (!/[a-zA-Z0-9-]/.test(char)) {
                                            allInvalidPositions.push(partStart + charIndex);
                                        }
                                    }
                                }
                            }
                        }

                        // Check top-level domain (last part) - should be letters only
                        const tld = domainParts[domainParts.length - 1];
                        if (tld) {
                            if (tld.length < 2) {
                                errors.push("Top-level domain must be at least 2 characters");
                            }
                            if (!/^[a-zA-Z]+$/.test(tld)) {
                                errors.push("Top-level domain should contain only letters");

                                // Find and mark invalid characters in TLD
                                let tldStart = atIndex + 1;
                                for (let k = 0; k < domainParts.length - 1; k++) {
                                    tldStart += domainParts[k].length + 1; // +1 for the dot
                                }

                                for (let charIndex = 0; charIndex < tld.length; charIndex++) {
                                    const char = tld[charIndex];
                                    if (!/[a-zA-Z]/.test(char)) {
                                        allInvalidPositions.push(tldStart + charIndex);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Remove duplicates from invalid positions
        const uniqueInvalidPositions = [...new Set(allInvalidPositions)];

        setEmailErrors(errors);
        setEmailInvalidPositions(uniqueInvalidPositions);
        return errors.length === 0;
    };

    const validatePassword = (pass: string) => {
        const { isValid, issues } = validateVisualPassword(pass, email, username);

        if (!isValid) {
            setPasswordError(issues.join(", "));
            return false;
        }

        setPasswordError("");
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setAuthError(null); // Clear any previous errors

        const trimmedUsername = username.trim();
        const trimmedPassword = password;
        const trimmedEmail = email.trim();

        try {
            let success = false;

            if (isRegistering) {
                // Validate email for registration
                if (!validateEmail(trimmedEmail)) {
                    setIsLoading(false);
                    return;
                }

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

                // Wait for the Promise to resolve from register
                console.log("Registering user...");
                success = await onRegister(trimmedUsername, trimmedEmail, trimmedPassword);
                console.log("Register API call completed, success:", success);
            } else {
                console.log("Logging in user...");
                // Wait for the Promise to resolve from login
                success = await onLogin(trimmedUsername, trimmedPassword);
                console.log("Login API call completed, success:", success);
            }

            // If authentication failed, stop loading and show error
            if (!success) {
                // No delay - immediately show error and stop loading
                setIsLoading(false);
                setAuthError(
                    isRegistering
                        ? "Registration failed. Please check your information and try again."
                        : "Login failed. Please check your credentials and try again."
                );
            }
            // For success case, keep loading state on as we'll likely navigate away
        } catch (error) {
            console.error("Authentication error:", error);
            setIsLoading(false);
            setAuthError("An error occurred during authentication. Please try again.");
        }
    };

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newPassword = e.target.value;
        setPassword(newPassword);
    };

    const handleUsernameChange = (e: React.FormEvent<HTMLElement>) => {
        const value = (e.target as HTMLInputElement).value;
        // Automatically replace spaces with underscores
        const cleanedUsername = value.replace(/\s/g, "_");
        setUsername(cleanedUsername);
    };

    const handleBackToLogin = () => {
        setResetEmailComplete(false);
        setIsForgettingPassword(false);
        // setResetEmail("");
    };

    const handleForgotPassword = () => {
        setIsForgettingPassword(true);
    };

    const handleForgotPasswordSubmit = async (e: React.FormEvent<HTMLElement>) => {
        e.preventDefault();
        setIsLoading(true);
        setResetEmailErrorMessage(null);

        vscode.postMessage({
            command: "auth.requestPasswordReset",
            // resetEmail: resetEmail,
        } as MessagesToStartupFlowProvider);
    };

    return (
        <div className="login-register-step">
            {isMissingExtension && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "1rem",
                        padding: "8px 12px",
                        backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                        border: "1px solid var(--vscode-inputValidation-errorBorder)",
                        borderRadius: "4px",
                        width: "min(100%, 400px)",
                    }}
                >
                    <span>
                        Frontier Authentication extension is missing or disabled. Please{" "}
                        <span
                            onClick={() =>
                                vscode.postMessage({ command: "extension.installFrontier" })
                            }
                            style={{
                                textDecoration: "underline",
                                cursor: "pointer",
                                fontWeight: "600",
                            }}
                            role="button"
                            tabIndex={0}
                        >
                            install or enable it
                        </span>{" "}
                        to proceed.
                        <br />
                        <br />
                        You may need to restart the application for changes to apply.
                    </span>
                </div>
            )}
            <div className="flex justify-between w-full gap-2 items-center">
                        <VSCodeButton
                    appearance="secondary"
                            onClick={onSkip}
                            disabled={isLoading}
                >
                    Skip Login
                    <i className="codicon codicon-arrow-right" style={{ marginLeft: "4px" }}></i>
                </VSCodeButton>
                {isForgettingPassword ? (
                    <VSCodeButton
                        className="hover:bg-transparent"
                        onClick={handleBackToLogin}
                        appearance="icon"
                        disabled={isLoading || isMissingExtension}
                        >
                            <span
                                style={{
                                    textDecoration: "underline",
                                    width: "auto",
                                    height: "auto",
                                }}
                            >
                            Back to Login
                            </span>
                        </VSCodeButton>
                ) : (
                        <VSCodeButton
                            className="hover:bg-transparent"
                            onClick={() => setIsRegistering(!isRegistering)}
                            appearance="icon"
                        disabled={isLoading || isMissingExtension || isOffline}
                        >
                            <span
                                style={{
                                    textDecoration: "underline",
                                    width: "auto",
                                    height: "auto",
                                }}
                            >
                                {isRegistering ? "Back to Login" : "Create Account"}
                            </span>
                        </VSCodeButton>
                )}
                    </div>
            {!isForgettingPassword && <h2>{isRegistering ? "Register" : "Login"}</h2>}
            {isOffline && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "1rem",
                        padding: "8px 12px",
                        backgroundColor: "var(--vscode-inputValidation-warningBackground)",
                        border: "1px solid var(--vscode-inputValidation-warningBorder)",
                        borderRadius: "4px",
                        width: "min(100%, 400px)",
                    }}
                >
                    <i className="codicon codicon-warning"></i>
                    <span>
                        You appear to be offline. Login and registration require an internet
                        connection.
                    </span>
                </div>
            )}
            {!isForgettingPassword ? (
                <>
                    {authError && (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                marginBottom: "1rem",
                                padding: "8px 12px",
                                backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                                border: "1px solid var(--vscode-inputValidation-errorBorder)",
                                borderRadius: "4px",
                                width: "min(100%, 400px)",
                            }}
                        >
                            <i className="codicon codicon-error"></i>
                            <span>{authError}</span>
                        </div>
                    )}
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
                                onInput={(e) => {
                                    const value = (e.target as HTMLInputElement).value;
                                    // Automatically replace spaces with underscores
                                    const cleanedUsername = value.replace(/\s/g, "_");
                                    setUsername(cleanedUsername);
                                }}
                                placeholder="Username"
                                required
                                style={{ width: "100%" }}
                                disabled={isLoading || isMissingExtension || isOffline}
                            />
                            {isRegistering && (
                                <div
                                    style={{
                                        fontSize: "0.85em",
                                        color: "var(--vscode-descriptionForeground)",
                                        marginTop: "4px",
                                        width: "100%",
                                    }}
                                >
                                    Spaces will be automatically replaced with underscores
                                </div>
                            )}
                            {isRegistering && (
                                <>
                                    <VSCodeTextField
                                        type="email"
                                        value={email}
                                        onInput={(e) => {
                                            const newEmail = (e.target as HTMLInputElement).value;
                                            setEmail(newEmail);

                                            // Real-time validation for registration
                                            if (isRegistering && newEmail.trim()) {
                                                validateEmail(newEmail);
                                            } else if (isRegistering) {
                                                setEmailErrors([]); // Clear errors when field is empty during typing
                                                setEmailInvalidPositions([]);
                                            }
                                        }}
                                        placeholder="Email"
                                        required
                                        style={{ width: "100%" }}
                                        disabled={isLoading || isMissingExtension || isOffline}
                                    />
                                    <EmailDisplayIndicator
                                        email={email}
                                        invalidPositions={emailInvalidPositions}
                                        showIndicator={isRegistering}
                                    />
                                    {emailErrors.length > 0 && (
                                        <div
                                            style={{
                                                color: "var(--vscode-errorForeground)",
                                                fontSize: "0.85em",
                                                alignSelf: "flex-start",
                                                marginTop: "0rem",
                                                marginBottom: "0.5rem",
                                                width: "100%",
                                                textAlign: "left",
                                            }}
                                        >
                                            {emailErrors.map((error, index) => (
                                                <div
                                                    key={index}
                                                    style={{
                                                        marginBottom:
                                                            index < emailErrors.length - 1
                                                                ? "4px"
                                                                : "0",
                                                        textAlign: "left",
                                                    }}
                                                >
                                                    {error}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                            <div className="flex flex-col w-full relative gap-y-2">
                                <div className="flex items-center gap-[0.5rem] w-full">
                                    <VSCodeTextField
                                        className="w-full"
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onInput={(e) =>
                                            handlePasswordChange(
                                                e as React.ChangeEvent<HTMLInputElement>
                                            )
                                        }
                                        placeholder="Password"
                                        required
                                        disabled={isLoading || isMissingExtension || isOffline}
                                    />
                                    <VSCodeButton
                                        className="absolute right-1 top-1 hover:bg-transparent"
                                        appearance="icon"
                                        onClick={() => setShowPassword(!showPassword)}
                                        disabled={isLoading || isMissingExtension || isOffline}
                                    >
                                        <i
                                            className={`codicon ${
                                                showPassword ? "codicon-eye" : "codicon-eye-closed"
                                            }`}
                                        ></i>
                                    </VSCodeButton>
                                </div>
                                <div className="flex justify-end w-full">
                                    <span
                                        className="text-sm cursor-pointer hover:underline text-var(--vscode-editor-foreground)"
                                        onClick={
                                            isMissingExtension || isOffline ? undefined : handleForgotPassword
                                        }
                                        style={{
                                            opacity: isMissingExtension || isOffline ? 0.5 : 1,
                                            pointerEvents: isMissingExtension || isOffline ? "none" : "auto",
                                            cursor: isMissingExtension || isOffline ? "not-allowed" : "pointer",
                                        }}
                                    >
                                        Forgot Password?
                                    </span>
                                </div>
                                {isRegistering && (
                                    <PasswordDotsIndicator
                                        password={password}
                                        email={email}
                                        username={username}
                                        minLength={15}
                                        showIndicator={true}
                                    />
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
                                        disabled={isLoading || isMissingExtension || isOffline}
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
                            className="button-group login-button-row"
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                gap: "1rem",
                                marginTop: "1rem",
                            }}
                        >
                            <VSCodeButton
                                type="submit"
                                disabled={
                                    isLoading ||
                                    isMissingExtension ||
                                    !authState?.isAuthExtensionInstalled ||
                                    isOffline
                                }
                                style={{
                                    width: "160px",
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                    position: "relative",
                                    overflow: "hidden",
                                }}
                            >
                                {isLoading ? (
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            width: "100%",
                                        }}
                                    >
                                        <i className="codicon codicon-loading codicon-modifier-spin"></i>
                                        <span style={{ marginLeft: "6px", whiteSpace: "nowrap" }}>
                                            {isRegistering ? "Registering" : "Logging in"}
                                        </span>
                                    </div>
                                ) : isRegistering ? (
                                    "Register"
                                ) : (
                                    "Login"
                                )}
                            </VSCodeButton>
                            {isLoading && (
                                <VSCodeButton
                                    appearance="icon"
                                    onClick={() => setIsLoading(false)}
                                    title="Cancel"
                                    style={{ height: "28px", minWidth: "28px", padding: "0" }}
                                >
                                    <i
                                        className="codicon codicon-close"
                                        style={{ margin: "0" }}
                                    ></i>
                                </VSCodeButton>
                            )}
                        </div>
                    </form>
                </>
            ) : (
                <>
                    {!resetEmailComplete ? (
                        <>
                            <h2>Reset Password</h2>
                            <div className="flex flex-col gap-y-1.5 items-center [width:min(100%,400px)]">
                                {/*
                                <VSCodeTextField
                                    type="email"
                                    value={resetEmail}
                                    onInput={(e) => {
                                        const newEmail = (e.target as HTMLInputElement).value;
                                        setResetEmail(newEmail);
                                        setResetEmailErrorMessage(null);

                                        // Real-time validation for registration
                                        if (newEmail.trim()) {
                                            validateEmail(newEmail);
                                        } else if (!newEmail.trim()) {
                                            setEmailErrors([]); // Clear errors when field is empty during typing
                                            setEmailInvalidPositions([]);
                                        }
                                    }}
                                    placeholder="Email"
                                    required
                                    style={{ width: "100%" }}
                                    disabled={isLoading || isMissingExtension || isOffline}
                                />
                                <EmailDisplayIndicator
                                    email={resetEmail}
                                    invalidPositions={emailInvalidPositions}
                                    showIndicator={false}
                                />
                                {emailErrors.length > 0 && (
                                    <div
                                        style={{
                                            color: "var(--vscode-errorForeground)",
                                            fontSize: "0.85em",
                                            alignSelf: "flex-start",
                                            marginTop: "0rem",
                                            marginBottom: "0.5rem",
                                            width: "100%",
                                            textAlign: "left",
                                        }}
                                    >
                                        {emailErrors.map((error, index) => (
                                            <div
                                                key={index}
                                                style={{
                                                    marginBottom:
                                                        index < emailErrors.length - 1
                                                            ? "4px"
                                                            : "0",
                                                    textAlign: "left",
                                                }}
                                            >
                                                {error}
                                            </div>
                                        ))}
                                    </div>
                                )}
                                */}
                                <div className="text-center text-sm text-foreground">
                                    We will open the password reset page in your default browser.
                                </div>
                                <div className="flex justify-center w-full mt-2">
                                    <VSCodeButton
                                        type="button"
                                        onClick={handleForgotPasswordSubmit}
                                        disabled={isLoading || isMissingExtension || isOffline}
                                        className="relative flex justify-center items-center min-w-[160px]"
                                    >
                                        <span className="text-var(--vscode-button-foreground) w-full">
                                            Open Reset Page
                                        </span>
                                    </VSCodeButton>
                                </div>
                            </div>
                            {resetEmailErrorMessage && (
                                <div className="text-red-500">{resetEmailErrorMessage}</div>
                            )}
                        </>
                    ) : (
                        <div className="mt-8 flex flex-col justify-center items-center w-full gap-y-2">
                            <i
                                className="codicon codicon-pass-filled text-green-500"
                                style={{ fontSize: "2rem" }}
                            ></i>
                            <div className="text-xl">
                                Password reset page opened in your browser.
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
