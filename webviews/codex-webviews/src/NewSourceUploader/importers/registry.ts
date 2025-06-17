import { ImporterPlugin, ImporterRegistry } from '../types/common';
import { docxImporter } from './docx';
// import { markdownImporter } from './markdown';
// import { ebibleCorpusImporter } from './ebibleCorpus';
import { obsImporter } from './obs';

/**
 * Registry of all available importers
 */
export const importerRegistry: ImporterRegistry = {
    docx: docxImporter,
    // markdown: markdownImporter,
    // ebibleCorpus: ebibleCorpusImporter,
    obs: obsImporter,
};

/**
 * Get all registered importers
 */
export const getAvailableImporters = (): ImporterPlugin[] => {
    return Object.values(importerRegistry);
};

/**
 * Get importer by file extension
 */
export const getImporterByExtension = (fileName: string): ImporterPlugin | null => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (!extension) return null;

    for (const importer of getAvailableImporters()) {
        if (importer.supportedExtensions.includes(extension)) {
            return importer;
        }
    }

    return null;
};

/**
 * Get importer by name
 */
export const getImporterByName = (name: string): ImporterPlugin | null => {
    return importerRegistry[name] || null;
};

/**
 * Check if a file type is supported
 */
export const isFileTypeSupported = (fileName: string): boolean => {
    return getImporterByExtension(fileName) !== null;
};

/**
 * Get all supported file extensions
 */
export const getSupportedExtensions = (): string[] => {
    const extensions = new Set<string>();

    getAvailableImporters().forEach(importer => {
        importer.supportedExtensions.forEach(ext => extensions.add(ext));
    });

    return Array.from(extensions).sort();
}; 