import * as vscode from "vscode";

export interface UserPreferences {
    skipOnboarding?: boolean;
    lastOnboardingVersion?: string;
    skipSampleProjectPrompt?: boolean;
}

const PREFERENCES_KEY = "codex-editor.userPreferences";

/**
 * Get user preference value
 */
export async function getUserPreference<K extends keyof UserPreferences>(
    context: vscode.ExtensionContext,
    key: K
): Promise<UserPreferences[K] | undefined> {
    const preferences = context.globalState.get<UserPreferences>(PREFERENCES_KEY, {});
    return preferences[key];
}

/**
 * Set user preference value
 */
export async function setUserPreference<K extends keyof UserPreferences>(
    context: vscode.ExtensionContext,
    key: K,
    value: UserPreferences[K]
): Promise<void> {
    const preferences = context.globalState.get<UserPreferences>(PREFERENCES_KEY, {});
    preferences[key] = value;
    await context.globalState.update(PREFERENCES_KEY, preferences);
}

/**
 * Check if onboarding should be shown
 */
export async function shouldShowOnboarding(context: vscode.ExtensionContext): Promise<boolean> {
    const skipOnboarding = await getUserPreference(context, "skipOnboarding");
    return !skipOnboarding;
}

/**
 * Check if sample project prompt should be shown
 */
export async function shouldShowSampleProjectPrompt(context: vscode.ExtensionContext): Promise<boolean> {
    const skipSampleProjectPrompt = await getUserPreference(context, "skipSampleProjectPrompt");
    return !skipSampleProjectPrompt;
}

/**
 * Get all user preferences
 */
export function getUserPreferences(context: vscode.ExtensionContext): UserPreferences {
    return context.globalState.get<UserPreferences>(PREFERENCES_KEY, {});
}

