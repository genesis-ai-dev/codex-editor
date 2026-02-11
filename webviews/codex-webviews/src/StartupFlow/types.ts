import * as vscode from "vscode";
import { ConflictFile } from "../../../../src/projectManager/utils/merge/types";
import { ResolvedFile } from "../../../../src/projectManager/utils/merge/resolvers";

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

export interface CodexFile {
    id: string;
    name: string;
    path: string;
}

export interface TranslationAssociation {
    file: File;
    codexId: string;
}

export interface GitLabInfo {
    username: string;
    email?: string;
    id?: string;
    // Add other GitLab user properties as needed
}

export interface LoginRegisterStepProps {
    authState?: AuthState;
    vscode: any;
    onLogin: (username: string, password: string) => Promise<boolean>;
    onRegister: (username: string, email: string, password: string) => Promise<boolean>;
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
    getAuthStatus(): { isAuthenticated: boolean; gitlabInfo?: any; };
    onAuthStatusChanged(
        callback: (status: { isAuthenticated: boolean; gitlabInfo?: any; }) => void
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
        callback: (status: { isAuthenticated: boolean; }) => void
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
    cloneRepository: (
        repositoryUrl: string,
        cloneToPath?: string,
        openWorkspace?: boolean,
        mediaStrategy?: string
    ) => Promise<boolean>;
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
    getAsrEndpoint: () => Promise<string | undefined>;
    syncChanges: (options?: { commitMessage?: string; }) => Promise<{
        hasConflicts: boolean;
        conflicts?: Array<ConflictFile>;
        offline?: boolean;
    }>;
    completeMerge: (resolvedFiles: ResolvedFile[], workspacePath: string | undefined) => Promise<void>;
    onSyncStatusChange: (
        callback: (status: { status: 'started' | 'completed' | 'error' | 'skipped', message?: string; }) => void
    ) => vscode.Disposable;

    downloadLFSFile: (
        projectPath: string,
        oid: string,
        size: number
    ) => Promise<Buffer>;
}
