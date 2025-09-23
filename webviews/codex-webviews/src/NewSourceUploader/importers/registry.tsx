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
import { maculaBibleImporterPlugin } from "./maculaBible/index.tsx";
import { subtitlesImporterPlugin } from "./subtitles/index.tsx";
import { obsImporterPlugin } from "./obs/index.tsx";
import { smartSegmenterPlugin } from "./recursiveTextSplitter/index.tsx";
import { paratextImporterPlugin } from "./paratext/index.tsx";
import { spreadsheetImporterPlugin } from "./spreadsheet/index.tsx";
import { audioImporterPlugin } from "./audio/index.tsx";
import { tmsImporterPlugin } from "./tms/index.tsx";
// import { rtfImporterPlugin } from "./rtf/index.tsx";
// import { pdfImporterPlugin } from "./pdf/index.tsx";
import { indesignImporterPlugin } from "./indesign/index.tsx";

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
 * Organized with Essential tools first (general-purpose, broad appeal)
 * followed by Specialized tools (domain-specific)
 */
export const importerPlugins: ImporterPlugin[] = [
    // Essential Tools - General purpose importers for broad appeal
    {
        ...smartSegmenterPlugin,
        name: "Smart Segmenter",
        description: "Works with any text file",
        tags: [...(smartSegmenterPlugin.tags || []), "Essential", "Universal", "Text"],
    },
    {
        ...audioImporterPlugin,
        name: "Audio",
        description: "Import audio files and segment by timestamps",
        tags: [...(audioImporterPlugin.tags || []), "Essential", "Media", "Audio"],
    },
    {
        ...docxImporterPlugin,
        name: "Word Documents",
        description: "Microsoft Word files with images",
        tags: [...(docxImporterPlugin.tags || []), "Essential", "Documents", "Microsoft"],
    },
    {
        ...markdownImporterPlugin,
        name: "Markdown",
        description: "GitHub-style markdown files",
        tags: [...(markdownImporterPlugin.tags || []), "Essential", "Documentation", "GitHub"],
    },
    {
        ...subtitlesImporterPlugin,
        name: "Subtitles",
        description: "Video captions with timestamps",
        tags: [...(subtitlesImporterPlugin.tags || []), "Essential", "Media", "Video"],
    },
    {
        ...spreadsheetImporterPlugin,
        name: "Spreadsheets",
        description: "Excel and Google Sheets",
        tags: [...(spreadsheetImporterPlugin.tags || []), "Essential", "Spreadsheet", "Excel"],
    },
    {
        ...tmsImporterPlugin,
        name: "TMS Files",
        description: "Translation memory and localization files",
        tags: [...(tmsImporterPlugin.tags || []), "Translation", "Localization", "Bible"],
    },
    // {
    //     ...rtfImporterPlugin,
    //     name: "RTF Documents",
    //     description: "Rich Text Format files with Bible verses, chapters, and books",
    //     tags: [...(rtfImporterPlugin.tags || []), "Essential", "Documents"],
    // },
    // {
    //     ...pdfImporterPlugin,
    //     name: "PDF Documents",
    //     description: "Portable Document Format files with Bible text",
    //     icon: FileText,
    //     tags: ["Essential", "Documents", "PDF"],
    // },
    {
        ...indesignImporterPlugin,
        name: "InDesign Files",
        description: "Adobe InDesign IDML files with round-trip loss-free editing",
        tags: [...(indesignImporterPlugin.tags || []), "Essential", "Documents", "Adobe", "Professional", "Bible"],
    },

    // Specialized Tools - Domain-specific importers for Bible translation
    {
        ...usfmImporterPlugin,
        name: "USFM Files",
        description: "Unified Standard Format Marker files",
        tags: [...(usfmImporterPlugin.tags || []), "Specialized", "Bible", "USFM"],
    },
    {
        ...paratextImporterPlugin,
        name: "Paratext Projects",
        description: "Translation projects with settings",
        tags: [...(paratextImporterPlugin.tags || []), "Specialized", "Bible", "Paratext"],
    },
    {
        ...ebibleDownloadImporterPlugin,
        name: "eBible Download",
        description: "Download directly from eBible.org",
        tags: [...(ebibleDownloadImporterPlugin.tags || []), "Specialized", "Bible", "Download"],
    },
    {
        ...maculaBibleImporterPlugin,
        name: "Macula Bible",
        description: "Hebrew and Greek with annotations",
        tags: [
            ...(maculaBibleImporterPlugin.tags || []),
            "Specialized",
            "Bible",
            "Original Languages",
        ],
    },
    {
        ...obsImporterPlugin,
        name: "Bible Stories",
        description: "Open Bible Stories format",
        tags: [...(obsImporterPlugin.tags || []), "Specialized", "Bible", "Stories"],
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

/**
 * Get Essential importers (general-purpose, broad appeal)
 */
export const getEssentialImporters = (): ImporterPlugin[] => {
    return importerPlugins.filter((plugin) => plugin.tags?.includes("Essential"));
};

/**
 * Get Specialized importers (domain-specific tools)
 */
export const getSpecializedImporters = (): ImporterPlugin[] => {
    return importerPlugins.filter((plugin) => plugin.tags?.includes("Specialized"));
};

/**
 * Search plugins by name, description, or tags
 */
export const searchPlugins = (
    query: string,
    plugins: ImporterPlugin[] = importerPlugins
): ImporterPlugin[] => {
    if (!query.trim()) return plugins;

    const searchTerms = query
        .toLowerCase()
        .split(" ")
        .filter((term) => term.length > 0);

    return plugins.filter((plugin) => {
        const searchableText = [
            plugin.name,
            plugin.description,
            ...(plugin.tags || []),
            ...(plugin.supportedExtensions || []),
        ]
            .join(" ")
            .toLowerCase();

        return searchTerms.every((term) => searchableText.includes(term));
    });
};
