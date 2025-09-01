/**
 * Browser-based audio extraction utilities for extracting audio from video files
 * Uses Web Audio API and MediaRecorder to extract audio without blocking the main thread
 */

/**
 * For webview environments with strict CSP, we'll pass video files to backend for processing
 * This avoids CSP issues with blob URLs and media elements
 */
export async function extractAudioFromVideo(
    videoFile: File,
    startTime: number = 0,
    endTime?: number
): Promise<Blob> {
    try {
        console.log('Video file will be processed on backend for audio extraction');

        // Return the video file as-is, backend will handle audio extraction
        const arrayBuffer = await videoFile.arrayBuffer();
        return new Blob([arrayBuffer], { type: videoFile.type });
    } catch (error) {
        console.error('Error processing video file:', error);
        throw new Error('Failed to process video file');
    }
}

/**
 * Convert a Blob to a data URL
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Extract audio from video and return as data URL
 */
export async function extractAudioAsDataUrl(
    videoFile: File,
    startTime: number = 0,
    endTime?: number
): Promise<string> {
    const audioBlob = await extractAudioFromVideo(videoFile, startTime, endTime);
    return await blobToDataUrl(audioBlob);
}

/**
 * Check if a file is a video file
 */
export function isVideoFile(file: File): boolean {
    return file.type.startsWith('video/') ||
        /\.(mp4|mov|avi|mkv|webm|m4v|3gp|flv|wmv)$/i.test(file.name);
}

/**
 * Create an audio File object from video blob (backend will extract audio)
 */
export function createAudioFile(videoBlob: Blob, originalFileName: string): File {
    // Keep original file name and type for backend processing
    return new File([videoBlob], originalFileName, { type: videoBlob.type });
}
