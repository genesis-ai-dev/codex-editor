import { ProcessedImage } from '../types/common';

/**
 * Processes image data and converts it to a standard format
 */
export const processImageData = async (
    imageData: ArrayBuffer | string,
    metadata?: {
        alt?: string;
        title?: string;
        width?: number;
        height?: number;
    }
): Promise<ProcessedImage> => {
    let src: string;
    let originalData: ArrayBuffer | undefined;

    if (typeof imageData === 'string') {
        src = imageData;
    } else {
        // Convert ArrayBuffer to base64 data URL
        const uint8Array = new Uint8Array(imageData);
        const binaryString = uint8Array.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
        const base64 = btoa(binaryString);

        // Try to detect image type from the data
        const imageType = detectImageType(uint8Array);
        src = `data:${imageType};base64,${base64}`;
        originalData = imageData;
    }

    return {
        src,
        alt: metadata?.alt,
        title: metadata?.title,
        width: metadata?.width,
        height: metadata?.height,
        originalData,
    };
};

/**
 * Detects image type from binary data
 */
const detectImageType = (uint8Array: Uint8Array): string => {
    // PNG signature
    if (uint8Array.length >= 8 &&
        uint8Array[0] === 0x89 && uint8Array[1] === 0x50 &&
        uint8Array[2] === 0x4E && uint8Array[3] === 0x47) {
        return 'image/png';
    }

    // JPEG signature
    if (uint8Array.length >= 2 &&
        uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
        return 'image/jpeg';
    }

    // GIF signature
    if (uint8Array.length >= 6 &&
        uint8Array[0] === 0x47 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46) {
        return 'image/gif';
    }

    // WebP signature
    if (uint8Array.length >= 12 &&
        uint8Array[0] === 0x52 && uint8Array[1] === 0x49 &&
        uint8Array[2] === 0x46 && uint8Array[3] === 0x46 &&
        uint8Array[8] === 0x57 && uint8Array[9] === 0x45 &&
        uint8Array[10] === 0x42 && uint8Array[11] === 0x50) {
        return 'image/webp';
    }

    // Default to PNG if type cannot be detected
    return 'image/png';
};

/**
 * Extracts images from HTML content
 */
export const extractImagesFromHtml = async (html: string): Promise<ProcessedImage[]> => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const imgElements = doc.querySelectorAll('img');

    const images: ProcessedImage[] = [];

    for (const img of imgElements) {
        const src = img.getAttribute('src');
        if (src) {
            images.push({
                src,
                alt: img.getAttribute('alt') || undefined,
                title: img.getAttribute('title') || undefined,
                width: img.width || undefined,
                height: img.height || undefined,
            });
        }
    }

    return images;
};

/**
 * Replaces images in HTML content with processed versions
 */
export const replaceImagesInHtml = (html: string, imageReplacements: Map<string, ProcessedImage>): string => {
    let processedHtml = html;

    imageReplacements.forEach((processedImage, originalSrc) => {
        const imgRegex = new RegExp(`<img[^>]*src=['"]${originalSrc}['"][^>]*>`, 'gi');
        const replacement = `<img src="${processedImage.src}"${processedImage.alt ? ` alt="${processedImage.alt}"` : ''
            }${processedImage.title ? ` title="${processedImage.title}"` : ''
            }${processedImage.width ? ` width="${processedImage.width}"` : ''
            }${processedImage.height ? ` height="${processedImage.height}"` : ''
            } />`;

        processedHtml = processedHtml.replace(imgRegex, replacement);
    });

    return processedHtml;
};

/**
 * Validates that an image can be processed
 */
export const validateImage = (imageData: ArrayBuffer | string): boolean => {
    if (typeof imageData === 'string') {
        // Check if it's a valid URL or data URL
        return imageData.length > 0 && (
            imageData.startsWith('http') ||
            imageData.startsWith('data:image') ||
            imageData.startsWith('/')
        );
    }

    // Check if ArrayBuffer has valid image data
    const uint8Array = new Uint8Array(imageData);
    return uint8Array.length > 0 && detectImageType(uint8Array) !== 'image/png'; // Default means undetected
}; 