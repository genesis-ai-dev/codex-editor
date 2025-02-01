import { syncUtils } from "./../../../../src/activationHelpers/contextAware/syncUtils";
import { BiblePreviewData, PreviewContent } from "../../../../types";
import { DownloadBibleTransaction } from "../../../../src/transactions/DownloadBibleTransaction";
import * as vscode from "vscode";
import { ConflictFile } from "../../../../src/projectManager/utils/merge/types";

// Add ImportType type
export type ImportType = "source" | "translation" | "bible-download";

// Update WorkflowStep to include the new initial steps
export type WorkflowStep =
    | "auth"
    | "project-select"
    | "type-select"
    | "select"
    | "preview-download"
    | "preview"
    | "processing"
    | "complete";

export type ProcessingStatus = "pending" | "active" | "complete" | "error";

export interface ProcessingStage {
    label: string;
    description: string;
    status: ProcessingStatus;
}

export interface ProcessingStages {
    [key: string]: ProcessingStage;
}

// Add specific Bible download stages
export interface BibleDownloadStages extends ProcessingStages {
    validation: ProcessingStage;
    download: ProcessingStage;
    splitting: ProcessingStage;
    notebooks: ProcessingStage;
    metadata: ProcessingStage;
    commit: ProcessingStage;
}

// Add Bible download specific state
export interface BibleDownloadState {
    language: string;
    translationId: string;
    status: "idle" | "downloading" | "complete" | "error";
    progress?: {
        stage: keyof BibleDownloadStages;
        message: string;
        increment: number;
    };
}

// Add project selection type
export type ProjectSelectionType = "clone" | "open" | "new";

// Add authentication state interface
export interface AuthState {
    isAuthenticated: boolean;
    isAuthExtensionInstalled: boolean;
    isLoading: boolean;
    error?: string;
    gitlabInfo?: GitLabInfo;
    workspaceState: {
        isWorkspaceOpen: boolean;
        isProjectInitialized: boolean;
    };
}

// Add project selection state interface
export interface ProjectSelectionState {
    type?: ProjectSelectionType;
    path?: string;
    repoUrl?: string;
    error?: string;
}

export interface MultiPreviewItem {
    id: string; // Unique ID for each preview
    fileName: string;
    fileSize: number;
    isValid: boolean;
    isRejected?: boolean;
    preview: PreviewContent | BiblePreviewData;
    sourceId?: string; // Optional sourceId for translation previews
}

export interface CodexFile {
    id: string;
    name: string;
    path: string;
}

export interface TranslationAssociation {
    file: File;
    codexId: string;
}

export interface WorkflowState {
    step: WorkflowStep;
    importType: ImportType | null;
    authState: AuthState;
    projectSelection: ProjectSelectionState;
    selectedFiles: string[];
    fileObjects: File[];
    selectedSourceId?: string;
    preview?: PreviewContent | BiblePreviewData;
    error?: string | null;
    progress?: {
        message: string;
        increment: number;
    };
    availableCodexFiles?: CodexFile[];
    bibleDownload?: BibleDownloadState;
    currentTransaction?: DownloadBibleTransaction;
    previews: MultiPreviewItem[];
    selectedPreviewId?: string;
    translationAssociations: TranslationAssociation[];
}

export interface ImportProgress {
    message: string;
    increment: number;
}

export interface GitLabInfo {
    username: string;
    email?: string;
    id?: string;
    // Add other GitLab user properties as needed
}

export interface LoginRegisterStepProps {
    // authState: AuthState;
    onLogin: (username: string, password: string) => void;
    onRegister: (username: string, email: string, password: string) => void;
    onLogout: () => void;
    onSkip: () => void;
}

export interface WorkspaceStepProps {
    onOpenWorkspace: () => void;
    onCreateNew: () => void;
}
interface TokenResponse {
    access_token: string;
    gitlab_token: string;
    gitlab_url: string;
}

interface IFrontierAuthProvider extends vscode.AuthenticationProvider, vscode.Disposable {
    readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
    readonly onDidChangeAuthentication: vscode.Event<void>;

    // Core authentication methods
    initialize(): Promise<void>;
    getSessions(): Promise<vscode.AuthenticationSession[]>;
    createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession>;
    removeSession(sessionId: string): Promise<void>;

    // Authentication status
    readonly isAuthenticated: boolean;
    getAuthStatus(): { isAuthenticated: boolean; gitlabInfo?: any };
    onAuthStatusChanged(
        callback: (status: { isAuthenticated: boolean; gitlabInfo?: any }) => void
    ): vscode.Disposable;

    // Token management
    getToken(): Promise<string | undefined>;
    setToken(token: string): Promise<void>;
    setTokens(tokenResponse: TokenResponse): Promise<void>;

    // GitLab specific methods
    getGitLabToken(): Promise<string | undefined>;
    getGitLabUrl(): Promise<string | undefined>;

    // User authentication methods
    login(username: string, password: string): Promise<boolean>;
    register(username: string, email: string, password: string): Promise<boolean>;
    logout(): Promise<void>;

    // Resource cleanup
    dispose(): void;
}
export interface FrontierAPI {
    authProvider: IFrontierAuthProvider;
    getAuthStatus: () => {
        isAuthenticated: boolean;
    };
    onAuthStatusChanged: (
        callback: (status: { isAuthenticated: boolean }) => void
    ) => vscode.Disposable;
    login: (username: string, password: string) => Promise<boolean>;
    register: (username: string, email: string, password: string) => Promise<boolean>;
    logout: () => Promise<void>;
    listProjects: (showUI?: boolean) => Promise<
        Array<{
            id: number;
            name: string;
            description: string | null;
            visibility: string;
            url: string;
            webUrl: string;
            lastActivity: string;
            namespace: string;
            owner: string;
        }>
    >;
    cloneRepository: (repositoryUrl: string) => Promise<boolean>;
    publishWorkspace: (options?: {
        name: string;
        description?: string;
        visibility?: "private" | "internal" | "public";
        organizationId?: string;
    }) => Promise<void>;
    getUserInfo: () => Promise<{
        email: string;
        username: string;
    }>;
    getLlmEndpoint: () => Promise<string | undefined>;
    syncChanges: () => Promise<{
        hasConflicts: boolean;
        conflicts?: Array<ConflictFile>;
    }>;
    completeMerge: (resolvedFiles: string[]) => Promise<void>;
}
