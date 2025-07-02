import React from "react";
import { ImporterPlugin } from "../types/plugin";
import {
    FileText,
    FileCode,
    BookOpen,
    Database,
    BookOpenCheck,
    Captions,
    Hash,
    FileJson,
    Download,
} from "lucide-react";

// Import the actual plugin definitions
import { docxImporterPlugin } from "./docx/index.tsx";
import { markdownImporterPlugin } from "./markdown/index.tsx";
import { usfmImporterPlugin } from "./usfm/index.tsx";
import { ebibleDownloadImporterPlugin } from "./ebibleCorpus/index.tsx";
import { subtitlesImporterPlugin } from "./subtitles/index.tsx";
import { obsImporterPlugin } from "./obs/index.tsx";
import { smartImportPlugin } from "./recursiveTextSplitter/index.tsx";
import { paratextImporterPlugin } from "./paratext/index.tsx";

// Import placeholder components - these will be created for each importer
// For now, we'll create a temporary placeholder component
const PlaceholderComponent: React.FC<{ name: string }> = ({ name }) => {
    return <div>Placeholder for {name} importer</div>;
};

// Temporary function to create placeholder components
const createPlaceholderComponent = (name: string) => {
    return () => <PlaceholderComponent name={name} />;
};

/**
 * Registry of all available importer plugins
 */
export const importerPlugins: ImporterPlugin[] = [
    smartImportPlugin, // Smart Import first - it's the most flexible
    docxImporterPlugin,
    markdownImporterPlugin,
    usfmImporterPlugin,
    paratextImporterPlugin,
    ebibleDownloadImporterPlugin,
    subtitlesImporterPlugin,
    obsImporterPlugin,
];

/**
 * Get an importer plugin by its ID
 */
export const getImporterById = (id: string): ImporterPlugin | undefined => {
    return importerPlugins.find((plugin) => plugin.id === id);
};

/**
 * Get importer by file extension
 */
export const getImporterByExtension = (fileName: string): ImporterPlugin | undefined => {
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (!extension) return undefined;

    return importerPlugins.find((plugin) => plugin.supportedExtensions?.includes(extension));
};

/**
 * Check if a file type is supported
 */
export const isFileTypeSupported = (fileName: string): boolean => {
    return getImporterByExtension(fileName) !== undefined;
};

/**
 * Get all supported file extensions
 */
export const getSupportedExtensions = (): string[] => {
    const extensions = new Set<string>();

    importerPlugins.forEach((plugin) => {
        plugin.supportedExtensions?.forEach((ext) => extensions.add(ext));
    });

    return Array.from(extensions).sort();
};
