import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
    ProcessedImage,
    ProcessedNotebook,
} from '../../types/common';
import {
    createProgress,
    createStandardCellId,
    createProcessedCell,
    validateFileExtension,
    addMilestoneCellsToNotebookPair,
} from '../../utils/workflowHelpers';
import { processImageData } from '../../utils/imageProcessor';
import JSZip from 'jszip';

const SUPPORTED_EXTENSIONS = ['md', 'zip'];

/**
 * Checks if a file path represents an image file
 */
const isImageFile = (filePath: string): boolean => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg'];
    const lowerPath = filePath.toLowerCase();
    return imageExtensions.some(ext => lowerPath.endsWith(ext));
};

// OBS Repository configuration
const OBS_REPO_CONFIG = {
    baseUrl: 'https://git.door43.org',
    owner: 'unfoldingWord',
    repo: 'en_obs',
    branch: 'master',
    contentPath: 'content',
};

/**
 * Validates an Open Bible Stories file or repository download request
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Special handling for repository download (indicated by a special filename)
    if (file.name === 'obs-repository-download.md') {
        // This is a repository download request - always valid
        return {
            isValid: true,
            fileType: 'obs-repository',
            errors: [],
            warnings: [],
            metadata: {
                fileSize: 0,
                lastModified: new Date().toISOString(),
                fileFormat: 'repository-download',
            },
        };
    }

    // Check file extension for regular file uploads
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .md or .zip extension');
    }

    // Check if file name suggests OBS content
    const fileName = file.name.toLowerCase();
    const isObsFile = fileName.includes('obs') ||
        fileName.includes('bible') ||
        fileName.includes('stories') ||
        /^\d{2}\.md$/.test(fileName); // Pattern like 01.md

    if (!isObsFile && fileName.endsWith('.md')) {
        warnings.push('File name does not clearly indicate Open Bible Stories content');
    }

    // For ZIP files, be more permissive - they might contain OBS content
    if (fileName.endsWith('.zip')) {
        warnings.push('ZIP file will be scanned for OBS markdown files and images');
    }

    // Check file size (warn if > 100MB for zip, > 10MB for single md)
    const maxSize = fileName.endsWith('.zip') ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
        warnings.push('Large files may take longer to process');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'obs',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
            fileFormat: fileName.endsWith('.zip') ? 'zip' : 'markdown',
        },
    };
};

/**
 * Parses an Open Bible Stories file or downloads from repository
 */
const parseFile = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        // Check if this is a repository download request
        if (file.name === 'obs-repository-download.md') {
            return await downloadObsRepository(onProgress);
        }

        onProgress?.(createProgress('Reading File', 'Reading OBS file...', 10));

        const isZip = file.name.toLowerCase().endsWith('.zip');

        if (isZip) {
            return await parseObsZip(file, onProgress);
        } else {
            return await parseObsMarkdown(file, onProgress);
        }

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process OBS file', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

/**
 * Downloads OBS repository content and processes all stories
 */
const downloadObsRepository = async (
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Repository Access', 'Fetching OBS repository contents...', 10));

        // Get directory listing to find all story files
        const contentFiles = await fetchRepositoryContents();

        onProgress?.(createProgress('Repository Access', `Found ${contentFiles.length} story files`, 20));

        // Download all story files
        const storyFiles: { name: string; content: string; }[] = [];
        const totalFiles = contentFiles.length;

        for (let i = 0; i < contentFiles.length; i++) {
            const file = contentFiles[i];
            onProgress?.(createProgress(
                'Downloading Stories',
                `Downloading ${file.name} (${i + 1}/${totalFiles})...`,
                20 + Math.round((i / totalFiles) * 50)
            ));

            try {
                const content = await fetchRawFileContent(file.path);
                storyFiles.push({ name: file.name, content });
            } catch (error) {
                console.warn(`Failed to download ${file.name}:`, error);
                // Continue with other files instead of failing completely
            }
        }

        if (storyFiles.length === 0) {
            throw new Error('No story files could be downloaded from the repository');
        }

        onProgress?.(createProgress('Processing Stories', 'Processing downloaded stories...', 75));

        // Process all stories into separate notebooks
        const sourceNotebooks: any[] = [];
        const codexNotebooks: any[] = [];
        const storyMetadata: any[] = [];

        for (const storyFile of storyFiles) {
            const obsStory = parseObsMarkdownContent(storyFile.content, storyFile.name);

            // Convert story segments to cells with proper verse-like IDs
            // Split text and images into separate cells
            const storyCells: any[] = [];
            let cellCounter = 1;

            for (const [segmentIndex, segment] of obsStory.segments.entries()) {
                const documentId = `OBS${obsStory.storyNumber.toString().padStart(2, '0')}`;
                const sectionId = '1'; // All segments are in section 1 for now

                // Create text cell if there's text content
                if (segment.text && segment.text.trim()) {
                    const textCellId = `${documentId} ${sectionId}:${cellCounter}`;
                    // Create HTML with just the text content, no images
                    const textOnlyHtml = `<p class="obs-text">${segment.text}</p>`;
                    const textCell = createProcessedCell(textCellId, textOnlyHtml, {
                        storyNumber: obsStory.storyNumber,
                        storyTitle: obsStory.title,
                        segmentType: 'text',
                        segmentIndex,
                        originalText: segment.text,
                        fileName: storyFile.name,
                        documentId,
                        sectionId,
                        cellIndex: cellCounter,
                        cellLabel: cellCounter.toString(),
                    });
                    storyCells.push(textCell);
                    cellCounter++;
                }

                // Create separate cells for each image
                if (segment.images.length > 0) {
                    for (const img of segment.images as ObsImage[]) {
                        const imageCellId = `${documentId} ${sectionId}:${cellCounter}`;
                        const processedImage = await processImageData(img.src, {
                            alt: img.alt,
                            title: img.title,
                        });

                        const imageCell = createProcessedCell(imageCellId, `<img src="${processedImage.src}" alt="${img.alt || ''}" title="${img.title || ''}" />`, {
                            storyNumber: obsStory.storyNumber,
                            storyTitle: obsStory.title,
                            segmentType: 'image',
                            segmentIndex,
                            originalImageSrc: img.src,
                            imageAlt: img.alt,
                            imageTitle: img.title,
                            fileName: storyFile.name,
                            documentId,
                            sectionId,
                            cellIndex: cellCounter,
                            cellLabel: cellCounter.toString(),
                        });

                        imageCell.images = [processedImage];
                        storyCells.push(imageCell);
                        cellCounter++;
                    }
                }
            }

            // Create individual story notebooks
            const storyName = obsStory.title;

            // Create matching codex cells - same IDs and structure as source
            const codexCells = storyCells.map(cell => {
                if (cell.metadata.segmentType === 'image') {
                    // Images carry over to codex unchanged
                    return { ...cell };
                } else {
                    // Text cells become empty in codex (for translation)
                    return createProcessedCell(cell.id, '', {
                        ...cell.metadata,
                        originalContent: cell.content, // Keep reference to original for context
                    });
                }
            });

            // Create source notebook
            const sourceNotebook: ProcessedNotebook = {
                name: storyName,
                cells: storyCells,
                metadata: {
                    id: `obs-${obsStory.storyNumber.toString().padStart(2, '0')}-source`,
                    originalFileName: storyFile.name,
                    corpusMarker: 'obs', // Enable round-trip export
                    importerType: 'obs',
                    createdAt: new Date().toISOString(),
                    storyNumber: obsStory.storyNumber,
                    storyTitle: obsStory.title,
                    segmentCount: storyCells.length,
                    imageCount: storyCells.filter(cell => cell.metadata.segmentType === 'image').length,
                    sourceReference: obsStory.sourceReference,
                    fileName: storyFile.name,
                    parentCollection: 'Open Bible Stories',

                    // Store OBS story structure for round-trip export
                    obsStory: JSON.stringify(obsStory),
                }
            };

            // Create codex notebook
            const codexNotebook: ProcessedNotebook = {
                name: storyName,
                cells: codexCells,
                metadata: {
                    id: `obs-${obsStory.storyNumber.toString().padStart(2, '0')}-codex`,
                    originalFileName: storyFile.name,
                    corpusMarker: 'obs', // Enable round-trip export
                    importerType: 'obs',
                    createdAt: new Date().toISOString(),
                    storyNumber: obsStory.storyNumber,
                    storyTitle: obsStory.title,
                    segmentCount: codexCells.length,
                    imageCount: codexCells.filter(cell => cell.metadata.segmentType === 'image').length,
                    sourceReference: obsStory.sourceReference,
                    fileName: storyFile.name,
                    parentCollection: 'Open Bible Stories',

                    // Store OBS story structure for round-trip export
                    obsStory: JSON.stringify(obsStory),
                }
            };

            sourceNotebooks.push(sourceNotebook);
            codexNotebooks.push(codexNotebook);

            storyMetadata.push({
                storyNumber: obsStory.storyNumber,
                storyTitle: obsStory.title,
                fileName: storyFile.name,
                segmentCount: storyCells.length,
                imageCount: obsStory.segments.reduce((count, seg) => count + seg.images.length, 0),
            });
        }

        onProgress?.(createProgress('Creating Notebooks', 'Creating OBS notebooks...', 90));

        // Convert individual notebooks to NotebookPair format
        const notebookPairs = sourceNotebooks.map((sourceNotebook, index) => {
            const notebookPair = {
                source: sourceNotebook,
                codex: codexNotebooks[index],
            };
            // Add milestone cells to each notebook pair
            return addMilestoneCellsToNotebookPair(notebookPair);
        });

        onProgress?.(createProgress('Complete', 'OBS repository download complete', 100));

        return {
            success: true,
            notebookPairs, // Return multiple pairs instead of single pair
            metadata: {
                source: 'repository',
                repositoryUrl: `${OBS_REPO_CONFIG.baseUrl}/${OBS_REPO_CONFIG.owner}/${OBS_REPO_CONFIG.repo}`,
                totalStories: storyFiles.length,
                totalSegments: storyMetadata.reduce((count, story) => count + story.segmentCount, 0),
                totalImages: storyMetadata.reduce((count, story) => count + story.imageCount, 0),
                stories: storyMetadata,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to download OBS repository', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred while downloading repository',
        };
    }
};

/**
 * Fetches the contents of the OBS repository content directory
 */
const fetchRepositoryContents = async (): Promise<{ name: string; path: string; }[]> => {
    const apiUrl = `${OBS_REPO_CONFIG.baseUrl}/api/v1/repos/${OBS_REPO_CONFIG.owner}/${OBS_REPO_CONFIG.repo}/contents/${OBS_REPO_CONFIG.contentPath}?ref=${OBS_REPO_CONFIG.branch}`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch repository contents: ${response.status} ${response.statusText}`);
    }

    const contents = await response.json();

    // Filter for .md files and sort them
    const mdFiles = contents
        .filter((item: any) => item.type === 'file' && item.name.endsWith('.md'))
        .filter((item: any) => /^\d{2}\.md$/.test(item.name) || item.name === 'front/intro.md' || item.name === 'back/intro.md')
        .sort((a: any, b: any) => {
            // Sort numbered files first, then front/back matter
            const aNum = parseInt(a.name.match(/^(\d+)/)?.[1] || '999');
            const bNum = parseInt(b.name.match(/^(\d+)/)?.[1] || '999');
            return aNum - bNum;
        })
        .map((item: any) => ({
            name: item.name,
            path: item.path
        }));

    return mdFiles;
};

/**
 * Fetches raw content of a file from the repository
 */
const fetchRawFileContent = async (filePath: string): Promise<string> => {
    const rawUrl = `${OBS_REPO_CONFIG.baseUrl}/${OBS_REPO_CONFIG.owner}/${OBS_REPO_CONFIG.repo}/raw/branch/${OBS_REPO_CONFIG.branch}/${filePath}`;

    const response = await fetch(rawUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${filePath}: ${response.status} ${response.statusText}`);
    }

    return await response.text();
};

/**
 * Parses a single OBS markdown file
 */
const parseObsMarkdown = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    onProgress?.(createProgress('Parsing Markdown', 'Parsing OBS markdown content...', 30));

    const text = await file.text();
    const obsStory = parseObsMarkdownContent(text, file.name);

    onProgress?.(createProgress('Processing Images', 'Processing OBS images...', 60));

    // Convert story segments to cells with separate cells for text and images
    // This matches the repository download behavior
    const cells: any[] = [];
    let cellCounter = 1;
    const documentId = `OBS${obsStory.storyNumber.toString().padStart(2, '0')}`;
    const sectionId = '1'; // All segments are in section 1

    for (const [segmentIndex, segment] of obsStory.segments.entries()) {
        // Create text cell if there's text content
        if (segment.text && segment.text.trim()) {
            const textCellId = `${documentId} ${sectionId}:${cellCounter}`;
            // Create HTML with just the text content, no images
            const textOnlyHtml = `<p class="obs-text">${segment.text}</p>`;
            const textCell = createProcessedCell(textCellId, textOnlyHtml, {
                storyNumber: obsStory.storyNumber,
                storyTitle: obsStory.title,
                segmentType: 'text',
                segmentIndex,
                originalText: segment.text,
                fileName: file.name,
                documentId,
                sectionId,
                cellIndex: cellCounter,
                cellLabel: cellCounter.toString(),
            });
            cells.push(textCell);
            cellCounter++;
        }

        // Create separate cells for each image
        if (segment.images.length > 0) {
            for (const img of segment.images) {
                const imageCellId = `${documentId} ${sectionId}:${cellCounter}`;

                // Process the image data
                let processedImage: ProcessedImage;
                try {
                    processedImage = await processImageData(img.src, {
                        alt: img.alt,
                        title: img.title,
                    });
                } catch (error) {
                    console.warn(`Failed to process image ${img.src}:`, error);
                    // Create a fallback processed image
                    processedImage = {
                        src: img.src,
                        alt: img.alt,
                        title: img.title,
                    };
                }

                const imageHtml = `<img src="${processedImage.src}" alt="${img.alt || ''}" title="${img.title || ''}" class="obs-image" />`;
                const imageCell = createProcessedCell(imageCellId, imageHtml, {
                    storyNumber: obsStory.storyNumber,
                    storyTitle: obsStory.title,
                    segmentType: 'image',
                    segmentIndex,
                    fileName: file.name,
                    documentId,
                    sectionId,
                    cellIndex: cellCounter,
                    cellLabel: cellCounter.toString(),
                    imageAlt: img.alt,
                    imageTitle: img.title,
                    originalImageSrc: img.src,
                });

                imageCell.images = [processedImage];
                cells.push(imageCell);
                cellCounter++;
            }
        }
    }

    onProgress?.(createProgress('Creating Notebooks', 'Creating OBS notebooks...', 80));

    // Read original file data for round-trip export
    const arrayBuffer = await file.arrayBuffer();

    // Create notebook pair manually
    const baseName = file.name.replace(/\.[^/.]+$/, '');

    const sourceNotebook = {
        name: baseName,
        cells,
        metadata: {
            id: `obs-source-${Date.now()}`,
            originalFileName: file.name,
            originalFileData: arrayBuffer, // Store original file for export - system will save to .project/attachments/originals/
            corpusMarker: 'obs', // Enable round-trip export
            importerType: 'obs',
            createdAt: new Date().toISOString(),
            storyNumber: obsStory.storyNumber,
            storyTitle: obsStory.title,
            totalSegments: obsStory.segments.length,
            imageCount: obsStory.segments.reduce((count, seg) => count + seg.images.length, 0),
            sourceReference: obsStory.sourceReference,

            // Store OBS story structure for round-trip export
            obsStory: JSON.stringify(obsStory), // Serialize for storage
        },
    };

    const codexCells = cells.map(sourceCell => ({
        id: sourceCell.id,
        content: sourceCell.images && sourceCell.images.length > 0
            ? sourceCell.images.map((img: any) => `<img src="${img.src}"${img.alt ? ` alt="${img.alt}"` : ''} />`).join('\n')
            : '', // Empty for translation, preserve images
        images: sourceCell.images,
        metadata: sourceCell.metadata,
    }));

    const codexNotebook = {
        name: baseName,
        cells: codexCells,
        metadata: {
            ...sourceNotebook.metadata,
            id: `obs-codex-${Date.now()}`,
            // Don't duplicate the original file data in codex
            originalFileData: undefined,
        },
    };

    const notebookPair = {
        source: sourceNotebook,
        codex: codexNotebook,
    };

    onProgress?.(createProgress('Complete', 'OBS processing complete', 100));

    return {
        success: true,
        notebookPair,
        metadata: {
            storyNumber: obsStory.storyNumber,
            storyTitle: obsStory.title,
            segmentCount: cells.length,
            imageCount: obsStory.segments.reduce((count, seg) => count + seg.images.length, 0),
        },
    };
};

/**
 * Parses an OBS zip file (downloads and processes multiple stories)
 */
const parseObsZip = async (
    file: File,
    onProgress?: ProgressCallback
): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Extracting Archive', 'Extracting ZIP file contents...', 10));

        const zip = new JSZip();
        const zipContent = await zip.loadAsync(file);

        // Find all markdown files in the zip
        const markdownFiles: { name: string; content: string; images: Map<string, ArrayBuffer>; }[] = [];
        const imageFiles = new Map<string, ArrayBuffer>();

        onProgress?.(createProgress('Scanning Files', 'Scanning for OBS content...', 20));

        // First pass: collect all image files
        for (const [relativePath, zipFile] of Object.entries(zipContent.files)) {
            if (!zipFile.dir && isImageFile(relativePath)) {
                const imageData = await zipFile.async('arraybuffer');
                imageFiles.set(relativePath, imageData);
            }
        }

        // Second pass: collect markdown files and associate images
        for (const [relativePath, zipFile] of Object.entries(zipContent.files)) {
            if (!zipFile.dir && relativePath.toLowerCase().endsWith('.md')) {
                // Skip system files and focus on story files
                if (relativePath.includes('__MACOSX') || relativePath.startsWith('.')) {
                    continue;
                }

                const content = await zipFile.async('text');
                const fileName = relativePath.split('/').pop() || relativePath;

                // Create a map of images that might be referenced in this markdown file
                const relatedImages = new Map<string, ArrayBuffer>();
                const basePath = relativePath.substring(0, relativePath.lastIndexOf('/') + 1);

                // Look for images in the same directory or common image directories
                for (const [imagePath, imageData] of imageFiles) {
                    if (imagePath.startsWith(basePath) ||
                        imagePath.includes('images/') ||
                        imagePath.includes('img/') ||
                        imagePath.includes(fileName.replace('.md', ''))) {
                        relatedImages.set(imagePath, imageData);
                    }
                }

                markdownFiles.push({
                    name: fileName,
                    content,
                    images: relatedImages,
                });
            }
        }

        if (markdownFiles.length === 0) {
            throw new Error('No markdown files found in the ZIP archive');
        }

        onProgress?.(createProgress('Processing Stories', `Processing ${markdownFiles.length} story files...`, 40));

        // Process all markdown files
        const sourceNotebooks: any[] = [];
        const codexNotebooks: any[] = [];
        const storyMetadata: any[] = [];

        for (let i = 0; i < markdownFiles.length; i++) {
            const markdownFile = markdownFiles[i];

            onProgress?.(createProgress(
                'Processing Stories',
                `Processing ${markdownFile.name} (${i + 1}/${markdownFiles.length})...`,
                40 + Math.round((i / markdownFiles.length) * 40)
            ));

            const obsStory = parseObsMarkdownContent(markdownFile.content, markdownFile.name);

            // Process story segments into cells, handling local images
            const cells: any[] = [];
            let cellCounter = 1;
            const documentId = `OBS${obsStory.storyNumber.toString().padStart(2, '0')}`;
            const sectionId = '1';

            for (const [segmentIndex, segment] of obsStory.segments.entries()) {
                // Create text cell if there's text content
                if (segment.text && segment.text.trim()) {
                    const textCellId = `${documentId} ${sectionId}:${cellCounter}`;
                    const textOnlyHtml = `<p class="obs-text">${segment.text}</p>`;
                    const textCell = createProcessedCell(textCellId, textOnlyHtml, {
                        storyNumber: obsStory.storyNumber,
                        storyTitle: obsStory.title,
                        segmentType: 'text',
                        segmentIndex,
                        originalText: segment.text,
                        fileName: markdownFile.name,
                        documentId,
                        sectionId,
                        cellIndex: cellCounter,
                        cellLabel: cellCounter.toString(),
                    });
                    cells.push(textCell);
                    cellCounter++;
                }

                // Create separate cells for each image, processing local images
                if (segment.images.length > 0) {
                    for (const img of segment.images) {
                        const imageCellId = `${documentId} ${sectionId}:${cellCounter}`;

                        // Try to find the image in our local files
                        let processedImage: ProcessedImage | null = null;
                        let imageFound = false;

                        // Look for the image in the related images
                        for (const [imagePath, imageData] of markdownFile.images) {
                            const imageName = imagePath.split('/').pop() || '';
                            const imgSrcName = img.src.split('/').pop() || '';

                            if (imageName === imgSrcName || imagePath.endsWith(img.src)) {
                                // Process the local image data
                                try {
                                    processedImage = await processImageData(imageData, {
                                        alt: img.alt,
                                        title: img.title,
                                    });
                                    imageFound = true;
                                    break;
                                } catch (error) {
                                    console.warn(`Failed to process local image ${imagePath}:`, error);
                                }
                            }
                        }

                        // If not found locally, try to process as URL (for repository images)
                        if (!imageFound || !processedImage) {
                            try {
                                processedImage = await processImageData(img.src, {
                                    alt: img.alt,
                                    title: img.title,
                                });
                            } catch (error) {
                                console.warn(`Failed to process image ${img.src}:`, error);
                                // Create a fallback processed image
                                processedImage = {
                                    src: img.src,
                                    alt: img.alt,
                                    title: img.title,
                                };
                            }
                        }

                        // Ensure we have a processed image
                        if (!processedImage) {
                            processedImage = {
                                src: img.src,
                                alt: img.alt,
                                title: img.title,
                            };
                        }

                        const imageCell = createProcessedCell(imageCellId, `<img src="${processedImage.src}" alt="${img.alt || ''}" title="${img.title || ''}" class="obs-image" />`, {
                            storyNumber: obsStory.storyNumber,
                            storyTitle: obsStory.title,
                            segmentType: 'image',
                            segmentIndex,
                            fileName: markdownFile.name,
                            documentId,
                            sectionId,
                            cellIndex: cellCounter,
                            cellLabel: cellCounter.toString(),
                            imageAlt: img.alt,
                            imageTitle: img.title,
                            originalImageSrc: img.src,
                        });

                        imageCell.images = [processedImage];
                        cells.push(imageCell);
                        cellCounter++;
                    }
                }
            }

            // Create individual story notebooks
            const storyName = obsStory.title || `Story ${obsStory.storyNumber}`;

            // Create matching codex cells
            const codexCells = cells.map(cell => {
                if (cell.metadata.segmentType === 'image') {
                    // Images carry over to codex unchanged
                    return { ...cell };
                } else {
                    // Text cells become empty in codex (for translation)
                    return createProcessedCell(cell.id, '', {
                        ...cell.metadata,
                        originalContent: cell.content,
                    });
                }
            });

            // Create source notebook
            const sourceNotebook: ProcessedNotebook = {
                name: storyName,
                cells,
                metadata: {
                    id: `obs-${obsStory.storyNumber.toString().padStart(2, '0')}-source`,
                    originalFileName: markdownFile.name,
                    corpusMarker: 'obs', // Enable round-trip export
                    importerType: 'obs',
                    createdAt: new Date().toISOString(),
                    storyNumber: obsStory.storyNumber,
                    storyTitle: obsStory.title,
                    segmentCount: cells.length,
                    imageCount: cells.filter(cell => cell.metadata.segmentType === 'image').length,
                    sourceReference: obsStory.sourceReference,
                    fileName: markdownFile.name,
                    parentCollection: 'Open Bible Stories',

                    // Store OBS story structure for round-trip export
                    obsStory: JSON.stringify(obsStory),
                }
            };

            // Create codex notebook
            const codexNotebook: ProcessedNotebook = {
                name: storyName,
                cells: codexCells,
                metadata: {
                    id: `obs-${obsStory.storyNumber.toString().padStart(2, '0')}-codex`,
                    originalFileName: markdownFile.name,
                    corpusMarker: 'obs', // Enable round-trip export
                    importerType: 'obs',
                    createdAt: new Date().toISOString(),
                    storyNumber: obsStory.storyNumber,
                    storyTitle: obsStory.title,
                    segmentCount: codexCells.length,
                    imageCount: codexCells.filter(cell => cell.metadata.segmentType === 'image').length,
                    sourceReference: obsStory.sourceReference,
                    fileName: markdownFile.name,
                    parentCollection: 'Open Bible Stories',

                    // Store OBS story structure for round-trip export
                    obsStory: JSON.stringify(obsStory),
                }
            };

            sourceNotebooks.push(sourceNotebook);
            codexNotebooks.push(codexNotebook);

            storyMetadata.push({
                storyNumber: obsStory.storyNumber,
                storyTitle: obsStory.title,
                fileName: markdownFile.name,
                segmentCount: cells.length,
                imageCount: obsStory.segments.reduce((count, seg) => count + seg.images.length, 0),
            });
        }

        onProgress?.(createProgress('Creating Notebooks', 'Creating OBS notebooks...', 90));

        // Convert individual notebooks to NotebookPair format
        const notebookPairs = sourceNotebooks.map((sourceNotebook, index) => ({
            source: sourceNotebook,
            codex: codexNotebooks[index],
        }));

        onProgress?.(createProgress('Complete', 'ZIP processing complete', 100));

        return {
            success: true,
            notebookPairs,
            metadata: {
                source: 'zip-file',
                fileName: file.name,
                totalStories: markdownFiles.length,
                totalSegments: storyMetadata.reduce((count, story) => count + story.segmentCount, 0),
                totalImages: storyMetadata.reduce((count, story) => count + story.imageCount, 0),
                stories: storyMetadata,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Failed to process ZIP file', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred while processing ZIP file',
        };
    }
};

/**
 * Parses OBS markdown content into structured data
 */
const parseObsMarkdownContent = (content: string, fileName: string): ObsStory => {
    const lines = content.split('\n');
    const segments: ObsSegment[] = [];

    let title = '';
    let storyNumber = 0;
    let sourceReference = '';
    let currentText = '';
    let currentImages: ObsImage[] = [];

    // Extract story number from filename (e.g., "01.md" -> 1)
    const fileMatch = fileName.match(/(\d+)\.md$/);
    if (fileMatch) {
        storyNumber = parseInt(fileMatch[1]);
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Extract title (first line starting with #)
        if (line.startsWith('# ') && !title) {
            title = line.substring(2).trim();
            continue;
        }

        // Extract source reference (last line starting with _)
        if (line.startsWith('_') && line.endsWith('_')) {
            sourceReference = line.substring(1, line.length - 1);
            continue;
        }

        // Extract image - handle various markdown image patterns
        if (line.includes('![') && line.includes('](')) {
            const imageMatches = line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g);
            for (const match of imageMatches) {
                const altText = match[1] || 'OBS Image';
                const imageSrc = match[2];
                currentImages.push({
                    src: imageSrc,
                    alt: altText,
                    title: altText.includes('OBS') ? `Story ${storyNumber}` : altText,
                });
            }
            continue;
        }

        // Regular text content
        if (line && !line.startsWith('#') && !line.startsWith('_')) {
            currentText += (currentText ? ' ' : '') + line;

            // Check if this is the end of a segment (next line is empty or image)
            const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
            const isEndOfSegment = !nextLine || nextLine.startsWith('![OBS Image]') || nextLine.startsWith('_');

            if (isEndOfSegment && currentText) {
                // Create segment with accumulated text and images
                const html = createObsSegmentHtml(currentText, currentImages);
                segments.push({
                    type: 'story',
                    text: currentText,
                    html,
                    images: [...currentImages],
                });

                currentText = '';
                currentImages = [];
            }
        }
    }

    return {
        storyNumber,
        title,
        segments,
        sourceReference,
    };
};

/**
 * Creates HTML for an OBS segment with text and images
 */
const createObsSegmentHtml = (text: string, images: ObsImage[]): string => {
    let html = '';

    // Add images at the beginning
    images.forEach(img => {
        html += `<img src="${img.src}" alt="${img.alt}" title="${img.title}" class="obs-image" />\n`;
    });

    // Add the text as a paragraph
    html += `<p class="obs-text">${text}</p>`;

    return html;
};

/**
 * Type definitions for OBS content
 */
interface ObsImage {
    src: string;
    alt: string;
    title?: string;
}

interface ObsSegment {
    type: 'story' | 'title' | 'intro';
    text: string;
    html: string;
    images: ObsImage[];
}

interface ObsStory {
    storyNumber: number;
    title: string;
    segments: ObsSegment[];
    sourceReference: string;
}

/**
 * Open Bible Stories Importer Plugin
 */
export const obsImporter: ImporterPlugin = {
    name: 'Open Bible Stories Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['text/markdown', 'application/zip'],
    description: 'Import Open Bible Stories markdown files with images and story structure from unfoldingWord',
    validateFile,
    parseFile,
}; 