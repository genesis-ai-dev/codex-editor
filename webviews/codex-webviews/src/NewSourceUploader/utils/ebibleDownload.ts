import { downloadEbibleCorpus, type EbibleMetadata } from '../importers/ebibleCorpus/download';
import { ImportResult, ProgressCallback } from '../types/common';

/**
 * Extended metadata interface that matches the backend ExtendedMetadata
 */
export interface ExtendedEbibleMetadata extends EbibleMetadata {
    title?: string;
    description?: string;
    direction?: 'ltr' | 'rtl';
    script?: string;
    abbreviation?: string;
}

/**
 * Download options for eBible corpus
 */
export interface EbibleDownloadOptions {
    metadata: ExtendedEbibleMetadata;
    asTranslationOnly?: boolean;
    onProgress?: ProgressCallback;
}

/**
 * Downloads an eBible corpus using the plugin architecture
 * This replaces the DownloadBibleTransaction functionality
 */
export const downloadBibleFromEbible = async (
    options: EbibleDownloadOptions
): Promise<ImportResult> => {
    const { metadata, asTranslationOnly = false, onProgress } = options;

    try {
        // Download using the plugin
        const result = await downloadEbibleCorpus(metadata, onProgress);

        if (!result.success) {
            throw new Error(result.error || 'Failed to download eBible corpus');
        }

        // Handle translation-only mode
        if (asTranslationOnly) {
            // In translation-only mode, we would need to update existing notebooks
            // For now, we'll just return the result with a flag
            return {
                ...result,
                metadata: {
                    ...result.metadata,
                    asTranslationOnly: true,
                    mode: 'translation-only',
                },
            };
        }

        return result;
    } catch (error) {
        onProgress?.({
            stage: 'Error',
            message: 'Download failed',
            status: 'error',
            progress: 0,
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/**
 * Validates eBible metadata before download
 */
export const validateEbibleMetadata = (metadata: ExtendedEbibleMetadata): string[] => {
    const errors: string[] = [];

    if (!metadata.languageCode || metadata.languageCode.trim() === '') {
        errors.push('Language code is required');
    }

    if (!metadata.translationId || metadata.translationId.trim() === '') {
        errors.push('Translation ID is required');
    }

    // Validate language code format (basic check)
    if (metadata.languageCode && !/^[a-z]{2,3}(-[a-z0-9-]+)*$/i.test(metadata.languageCode)) {
        errors.push('Language code format appears invalid (should be like "en", "es", "zh-cn")');
    }

    return errors;
};

/**
 * Generates a preview URL for the eBible corpus
 */
export const getEbiblePreviewUrl = (metadata: ExtendedEbibleMetadata): string => {
    const { languageCode, translationId } = metadata;

    // Check for special Macula Bible
    const isMaculaBible =
        languageCode === 'original-greek-hebrew' && translationId === 'macula-greek-hebrew';

    if (isMaculaBible) {
        return 'https://github.com/genesis-ai-dev/hebrew-greek-bible/raw/refs/heads/main/macula-ebible.txt';
    } else {
        // (a80bedcea96707e020eb04157f3ad3c2e7c02621 - updated with eBible Corpus Metadata)
        // (062b7b4e5b970493d1ef94f7b3bfce76052e7361 - later Bibles, but lacking updates)
        return `https://raw.githubusercontent.com/BibleNLP/ebible/a80bedcea96707e020eb04157f3ad3c2e7c02621/corpus/${languageCode}-${translationId}.txt`;
    }
};

/**
 * Checks if an eBible corpus is available at the given URL
 */
export const checkEbibleAvailability = async (metadata: ExtendedEbibleMetadata): Promise<{
    available: boolean;
    url: string;
    error?: string;
}> => {
    const url = getEbiblePreviewUrl(metadata);

    try {
        const response = await fetch(url, { method: 'HEAD' });
        return {
            available: response.ok,
            url,
            error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
        };
    } catch (error) {
        return {
            available: false,
            url,
            error: error instanceof Error ? error.message : 'Network error',
        };
    }
};

/**
 * Gets a list of popular eBible corpus options
 * This could be enhanced to fetch from a dynamic source
 */
export const getPopularEbibleOptions = (): ExtendedEbibleMetadata[] => {
    return [
        {
            languageCode: 'eng',
            translationId: 'web',
            title: 'World English Bible',
            description: 'Public domain English translation',
            direction: 'ltr',
            abbreviation: 'WEB',
        },
        {
            languageCode: 'spa',
            translationId: 'reina1960',
            title: 'Reina-Valera 1960',
            description: 'Spanish Bible translation',
            direction: 'ltr',
            abbreviation: 'RV60',
        },
        {
            languageCode: 'fra',
            translationId: 'lsg',
            title: 'Louis Segond 1910',
            description: 'French Bible translation',
            direction: 'ltr',
            abbreviation: 'LSG',
        },
        {
            languageCode: 'original-greek-hebrew',
            translationId: 'macula-greek-hebrew',
            title: 'Macula Hebrew and Greek Bible',
            description: 'Original language texts with morphological analysis',
            direction: 'rtl',
            abbreviation: 'MHGB',
        },
    ];
}; 