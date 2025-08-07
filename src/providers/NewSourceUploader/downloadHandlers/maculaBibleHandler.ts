/**
 * Download handler for the Macula Bible
 * This function will be executed on the provider side to avoid CORS issues
 */
export async function maculaBibleDownloadHandler(): Promise<{
    success: boolean;
    data?: any;
    error?: string;
}> {
    const MACULA_BIBLE_URL = "https://github.com/genesis-ai-dev/hebrew-greek-bible/raw/refs/heads/main/macula-ebible.txt";

    try {
        // Download the content
        const response = await fetch(MACULA_BIBLE_URL);
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        if (!text) {
            throw new Error("Received empty response from server");
        }

        // Parse the content into verses
        const lines = text.trim().split("\n");
        const verses: { vref: string; text: string; }[] = [];

        for (const line of lines) {
            const match = line.match(/^(\b[A-Z1-9]{3}\s\d+:\d+\b)\s+(.*)$/);
            if (match) {
                const [, vref, verseText] = match;
                verses.push({ vref, text: verseText.trim() });
            }
        }

        if (verses.length === 0) {
            throw new Error("No valid verses found in the downloaded content");
        }

        return {
            success: true,
            data: { verses }
        };

    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error occurred"
        };
    }
} 