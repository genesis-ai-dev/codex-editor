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
// import { docxImporterPlugin } from "./docx/index.tsx"; // Old mammoth.js importer
import { docxRoundtripImporterPlugin as docxImporterPlugin } from "./docx/experiment/index.tsx"; // New round-trip importer
import { markdownImporterPlugin } from "./markdown/index.tsx";
import { usfmImporterPlugin } from "./usfm/index.tsx"; // Original USFM importer
import { usfmExperimentalImporterPlugin } from "./usfm/experimental/index.tsx"; // Experimental round-trip importer (standalone with headers in chapter 1)
import { ebibleDownloadImporterPlugin } from "./ebibleCorpus/index.tsx";
import { maculaBibleImporterPlugin } from "./maculaBible/index.tsx";
import { subtitlesImporterPlugin } from "./subtitles/index.tsx";
import { obsImporterPlugin } from "./obs/index.tsx";
import { smartSegmenterPlugin } from "./recursiveTextSplitter/index.tsx";
import { paratextImporterPlugin } from "./paratext/index.tsx";
import { spreadsheetImporterPlugin } from "./spreadsheet/index.tsx";
import { audioImporterPlugin } from "./audio/index.tsx";
import { biblicaImporterPlugin } from "./biblica/index.tsx";
// import { biblicaSwapperImporterPlugin } from "./biblica-swapper/index.tsx";
import { tmsImporterPlugin } from "./tms/index.tsx";
// import { rtfImporterPlugin } from "./rtf/index.tsx";
import { pdfImporterPlugin } from "./pdf/index.tsx";
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
    // Non-beta importers first
    // {
    //     ...smartSegmenterPlugin,
    //     name: "Smart Segmenter",
    //     description: "Works with any text file",
    //     tags: [...(smartSegmenterPlugin.tags || []), "Essential", "Universal", "Text"],
    // },
    {
        ...audioImporterPlugin,
        name: "Audio",
        description: "Import audio files with backend processing - supports large files",
        tags: [...(audioImporterPlugin.tags || []), "Essential", "Media", "Audio"],
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
        ...tmsImporterPlugin,
        name: "TMS Files",
        description: "Translation memory and localization files (TMX/XLIFF)",
        tags: [...(tmsImporterPlugin.tags || []), "Essential", "Translation", "Localization"],
    },
    {
        ...docxImporterPlugin,
        name: "Word Documents",
        description: "Microsoft Word files with round-trip export support",
        tags: [...(docxImporterPlugin.tags || []), "Essential", "Documents", "Microsoft"],
    },
    {
        ...spreadsheetImporterPlugin,
        name: "Spreadsheets",
        description: "Excel and Google Sheets",
        tags: [...(spreadsheetImporterPlugin.tags || []), "Essential", "Spreadsheet", "Excel"],
    },
    {
        ...pdfImporterPlugin,
        name: "PDF Documents",
        description: "Portable Document Format files with Bible text",
        icon: FileText,
        tags: ["Essential", "Documents", "PDF"],
    },
    {
        ...indesignImporterPlugin,
        name: "InDesign Files",
        description: "Adobe InDesign IDML files with round-trip loss-free editing",
        tags: [...(indesignImporterPlugin.tags || []), "Essential", "Documents", "Adobe", "Professional", "Bible"],
    },

    // Specialized Tools - Domain-specific importers for Bible translation
    // Non-beta importers first
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
        description: "Open Bible Stories format with round-trip export support",
        tags: [...(obsImporterPlugin.tags || []), "Specialized", "Bible", "Stories", "Round-trip"],
    },
    // {
    //     ...biblicaSwapperImporterPlugin,
    //     name: "Biblica Bible Swapper",
    //     description: "Swap Bible text between two IDML files while preserving notes",
    //     tags: [...(biblicaSwapperImporterPlugin.tags || []), "Specialized", "Bible", "Biblica"],
    // },
    
    // Beta importers at the end of Specialized section
    {
        ...usfmExperimentalImporterPlugin,
        name: "USFM Experimental",
        description: "USFM files with round-trip export support (headers in chapter 1, verse-only target imports)",
        tags: [...(usfmExperimentalImporterPlugin.tags || []), "Specialized", "Bible", "USFM", "Experimental", "Round-trip"],
    },
    {
        ...biblicaImporterPlugin,
        name: "Biblica Files",
        description: "Biblica IDML importer with Study Bible",
        tags: [...(biblicaImporterPlugin.tags || []), "Specialized", "Bible", "Biblica"],
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
