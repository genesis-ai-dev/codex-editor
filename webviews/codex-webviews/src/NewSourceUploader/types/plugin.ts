import { NotebookPair, ProcessedNotebook } from './common';

/**
 * Props passed to each importer component
 */
export interface ImporterComponentProps {
    /**
     * Called when the import is complete with notebook pairs
     * Can be a single pair or multiple pairs for batch imports
     */
    onComplete: (notebooks: NotebookPair | NotebookPair[]) => void;

    /**
     * Called when the user wants to cancel and return to homepage
     */
    onCancel: () => void;
}

/**
 * Plugin definition for each importer
 */
export interface ImporterPlugin {
    /**
     * Unique identifier for this plugin
     */
    id: string;

    /**
     * Human-readable name
     */
    name: string;

    /**
     * Brief description of what this importer does
     */
    description: string;

    /**
     * Icon component from lucide-react or similar
     */
    icon: React.ComponentType<{ className?: string; }>;

    /**
     * The main React component for this importer
     */
    component: React.ComponentType<ImporterComponentProps>;

    /**
     * Optional: File extensions this plugin supports (for file-based importers)
     */
    supportedExtensions?: string[];

    /**
     * Optional: MIME types this plugin supports
     */
    supportedMimeTypes?: string[];

    /**
     * Optional: Whether this plugin is enabled
     */
    enabled?: boolean;

    /**
     * Optional: Tags for categorizing plugins
     */
    tags?: string[];
}

/**
 * Message types for communication with the provider
 */
export interface WriteNotebooksMessage {
    command: 'writeNotebooks';
    notebookPairs: NotebookPair[];
    metadata?: Record<string, any>;
}

export interface NotificationMessage {
    command: 'notification';
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
}

export interface ImportBookNamesMessage {
    command: 'importBookNames';
    xmlContent: string;
    nameType?: 'long' | 'short' | 'abbr';
}

export type ProviderMessage = WriteNotebooksMessage | NotificationMessage | ImportBookNamesMessage; 