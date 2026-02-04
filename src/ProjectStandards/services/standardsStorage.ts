import * as vscode from "vscode";
import { ProjectStandard, StandardType } from "../../../types";
import { cleanRegexResponse } from "./standardsEngine";

const STANDARDS_STORAGE_KEY = "codex.projectStandards";

/**
 * Mock organization standards - hardcoded for Phase 1.
 * These represent standards that would come from an org server in the future.
 */
const MOCK_ORG_STANDARDS: ProjectStandard[] = [
    {
        id: "org-divine-name",
        description: "Use 'LORD' (all caps) for YHWH, 'Lord' for Adonai",
        regexPattern: "\\bLord\\b(?!\\s+God|\\s+Jesus|\\s+LORD)",
        standardType: "regex-pattern",
        source: "org",
        enabled: true,
        examples: ["the Lord said", "Lord spoke"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
    {
        id: "org-god-pronouns",
        description: "Capitalize pronouns referring to God (He, His, Him)",
        regexPattern: "\\b(he|his|him)\\b(?=.*(?:God|LORD|Lord|Father|Almighty))",
        standardType: "regex-pattern",
        source: "org",
        enabled: true,
        examples: ["he spoke to Moses", "his word"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
    {
        id: "org-holy-spirit",
        description: "Capitalize 'Spirit' when referring to Holy Spirit",
        regexPattern: "\\b(?:holy\\s+)?spirit\\b(?!\\s+of\\s+(?:man|fear|jealousy))",
        standardType: "regex-pattern",
        source: "org",
        enabled: true,
        examples: ["the spirit descended", "holy spirit came"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    },
];

/**
 * Load project standards from workspace state.
 * Combines org standards (mock) with user-defined project standards.
 */
export async function loadStandards(workspaceState: vscode.Memento): Promise<ProjectStandard[]> {
    const orgStandards = getOrgStandards();
    const projectStandards = await loadProjectStandards(workspaceState);
    return [...orgStandards, ...projectStandards];
}

/**
 * Get organization standards (mock for Phase 1).
 * In the future, these would sync from an org server.
 */
export function getOrgStandards(): ProjectStandard[] {
    return MOCK_ORG_STANDARDS.map((standard) => ({ ...standard }));
}

/**
 * Load user-defined project standards from workspace state.
 */
export async function loadProjectStandards(workspaceState: vscode.Memento): Promise<ProjectStandard[]> {
    try {
        const standards = workspaceState.get<ProjectStandard[]>(STANDARDS_STORAGE_KEY) || [];

        // Validate and migrate standards if needed
        return standards.map(validateAndMigrateStandard).filter(Boolean) as ProjectStandard[];
    } catch (error) {
        console.error("[StandardsStorage] Error loading project standards:", error);
        return [];
    }
}

/**
 * Save project standards to workspace state.
 * Only saves project/manual/imported standards - org standards are not persisted.
 */
export async function saveProjectStandards(
    workspaceState: vscode.Memento,
    standards: ProjectStandard[]
): Promise<void> {
    try {
        // Filter out org standards - they shouldn't be persisted
        const projectStandards = standards.filter((s) => s.source !== "org");

        await workspaceState.update(STANDARDS_STORAGE_KEY, projectStandards);
    } catch (error) {
        console.error("[StandardsStorage] Error saving project standards:", error);
        throw new Error("Failed to save project standards");
    }
}

/**
 * Add a new project standard.
 * Returns the created standard with generated ID.
 */
export async function addStandard(
    workspaceState: vscode.Memento,
    standardData: Omit<ProjectStandard, "id" | "createdAt" | "updatedAt">
): Promise<ProjectStandard> {
    // Clean regex pattern if it's a regex literal (e.g., /pattern/gi -> pattern)
    const cleanedRegexPattern = standardData.regexPattern
        ? cleanRegexResponse(standardData.regexPattern)
        : "";

    const newStandard: ProjectStandard = {
        ...standardData,
        regexPattern: cleanedRegexPattern,
        id: generateStandardId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };

    const existingStandards = await loadProjectStandards(workspaceState);
    await saveProjectStandards(workspaceState, [...existingStandards, newStandard]);

    return newStandard;
}

/**
 * Update an existing project standard.
 * Cannot update org standards.
 */
export async function updateStandard(
    workspaceState: vscode.Memento,
    standard: ProjectStandard
): Promise<void> {
    if (standard.source === "org") {
        throw new Error("Cannot update organization standards");
    }

    const existingStandards = await loadProjectStandards(workspaceState);
    const index = existingStandards.findIndex((s) => s.id === standard.id);

    if (index === -1) {
        throw new Error(`Standard not found: ${standard.id}`);
    }

    // Clean regex pattern if it's a regex literal (e.g., /pattern/gi -> pattern)
    const cleanedRegexPattern = standard.regexPattern
        ? cleanRegexResponse(standard.regexPattern)
        : "";

    existingStandards[index] = {
        ...standard,
        regexPattern: cleanedRegexPattern,
        updatedAt: Date.now(),
    };

    await saveProjectStandards(workspaceState, existingStandards);
}

/**
 * Delete a project standard.
 * Cannot delete org standards.
 */
export async function deleteStandard(
    workspaceState: vscode.Memento,
    standardId: string
): Promise<void> {
    const existingStandards = await loadProjectStandards(workspaceState);
    const standard = existingStandards.find((s) => s.id === standardId);

    if (!standard) {
        throw new Error(`Standard not found: ${standardId}`);
    }

    if (standard.source === "org") {
        throw new Error("Cannot delete organization standards");
    }

    const filteredStandards = existingStandards.filter((s) => s.id !== standardId);
    await saveProjectStandards(workspaceState, filteredStandards);
}

/**
 * Toggle a standard's enabled state.
 * For org standards, this is temporary (not persisted).
 */
export async function toggleStandard(
    workspaceState: vscode.Memento,
    standardId: string,
    enabled: boolean,
    allStandards: ProjectStandard[]
): Promise<ProjectStandard[]> {
    const standardIndex = allStandards.findIndex((s) => s.id === standardId);

    if (standardIndex === -1) {
        throw new Error(`Standard not found: ${standardId}`);
    }

    const updatedStandards = [...allStandards];
    updatedStandards[standardIndex] = {
        ...updatedStandards[standardIndex],
        enabled,
        updatedAt: Date.now(),
    };

    // Only persist if it's a project standard
    if (updatedStandards[standardIndex].source !== "org") {
        const projectStandards = updatedStandards.filter((s) => s.source !== "org");
        await saveProjectStandards(workspaceState, projectStandards);
    }

    return updatedStandards;
}

/**
 * Update violation count for a standard (cached in memory, optionally persisted).
 */
export function updateViolationCount(
    standard: ProjectStandard,
    count: number
): ProjectStandard {
    return {
        ...standard,
        violationCount: count,
        lastScannedAt: Date.now(),
    };
}

/**
 * Generate a unique ID for a new standard.
 */
function generateStandardId(): string {
    return `std-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate and migrate a standard from storage.
 * Handles backwards compatibility if the schema changes.
 */
function validateAndMigrateStandard(standard: any): ProjectStandard | null {
    if (!standard || typeof standard !== "object") {
        return null;
    }

    // Ensure required fields exist
    if (!standard.id || !standard.description) {
        console.warn("[StandardsStorage] Invalid standard missing required fields:", standard);
        return null;
    }

    // Migrate older standards without standardType
    const migratedStandard: ProjectStandard = {
        id: standard.id,
        description: standard.description,
        regexPattern: standard.regexPattern || "",
        standardType: standard.standardType || "regex-pattern",
        source: standard.source || "manual",
        enabled: standard.enabled !== false,
        violationCount: standard.violationCount,
        lastScannedAt: standard.lastScannedAt,
        examples: standard.examples || [],
        sourceWord: standard.sourceWord,
        targetLanguage: standard.targetLanguage,
        contextRules: standard.contextRules,
        createdAt: standard.createdAt || Date.now(),
        updatedAt: standard.updatedAt || Date.now(),
        createdBy: standard.createdBy,
        citation: standard.citation,
    };

    return migratedStandard;
}

/**
 * Validate a regex pattern.
 * Returns true if valid, throws error with message if invalid.
 */
export function validateRegexPattern(pattern: string): boolean {
    if (!pattern || pattern.trim() === "") {
        throw new Error("Regex pattern cannot be empty");
    }

    try {
        new RegExp(pattern, "gi");
        return true;
    } catch (error) {
        throw new Error(`Invalid regex pattern: ${(error as Error).message}`);
    }
}

/**
 * Check if a standard type is supported in Phase 1.
 */
export function isStandardTypeSupported(type: StandardType): boolean {
    return type === "regex-pattern";
}
