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
import { docxImporter } from "./docx/index";
import { DocxImporterForm } from "./docx/DocxImporterForm";

// Import placeholder components - these will be created for each importer
// For now, we'll create a temporary placeholder component
const PlaceholderComponent: React.FC<{ name: string }> = ({ name }) => {
    return <div>Placeholder for {name} importer</div>;
};

// Temporary function to create placeholder components
const createPlaceholderComponent = (name: string) => {
    return () => <PlaceholderComponent name={name} />;
};

// Create the docx plugin using the imported components
const docxImporterPlugin: ImporterPlugin = {
    id: "docx",
    name: "DOCX Documents",
    description: "Import Microsoft Word DOCX files with rich formatting and images",
    icon: FileText,
    component: DocxImporterForm,
    supportedExtensions: ["docx"],
    enabled: true,
};

/**
 * Registry of all available importer plugins
 */
export const importerPlugins: ImporterPlugin[] = [
    docxImporterPlugin,
    {
        id: "markdown",
        name: "Markdown Files",
        description: "Import Markdown files with section-based splitting",
        icon: FileCode,
        component: createPlaceholderComponent("Markdown"),
        supportedExtensions: ["md", "markdown"],
        enabled: true,
    },
    {
        id: "ebible-corpus",
        name: "eBible Corpus",
        description: "Import eBible corpus files in TSV, CSV, or text format",
        icon: BookOpen,
        component: createPlaceholderComponent("eBible Corpus"),
        supportedExtensions: ["tsv", "csv", "txt"],
        enabled: true,
    },
    {
        id: "ebible-download",
        name: "eBible Download",
        description: "Download Bible translations directly from eBible repository",
        icon: Download,
        component: createPlaceholderComponent("eBible Download"),
        enabled: true,
        tags: ["download", "bible"],
    },
    {
        id: "usfm",
        name: "USFM Files",
        description: "Import Unified Standard Format Marker biblical text files",
        icon: FileCode,
        component: createPlaceholderComponent("USFM"),
        supportedExtensions: ["usfm", "sfm"],
        enabled: true,
    },
    {
        id: "paratext",
        name: "Paratext Projects",
        description: "Import Paratext translation projects",
        icon: Database,
        component: createPlaceholderComponent("Paratext"),
        supportedExtensions: ["xml", "ptx", "zip"],
        enabled: true,
    },
    {
        id: "obs",
        name: "Open Bible Stories",
        description: "Import Open Bible Stories markdown files from unfoldingWord",
        icon: BookOpenCheck,
        component: createPlaceholderComponent("OBS"),
        supportedExtensions: ["md", "zip"],
        enabled: true,
        tags: ["stories", "download"],
    },
    {
        id: "subtitles",
        name: "Subtitle Files",
        description: "Import VTT, SRT, or other subtitle files",
        icon: Captions,
        component: createPlaceholderComponent("Subtitles"),
        supportedExtensions: ["vtt", "srt", "ass"],
        enabled: true,
    },
    {
        id: "plaintext",
        name: "Plain Text",
        description: "Import plain text files with intelligent splitting",
        icon: FileText,
        component: createPlaceholderComponent("Plain Text"),
        supportedExtensions: ["txt"],
        enabled: true,
    },
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
