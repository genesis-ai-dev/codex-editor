import * as vscode from "vscode";

export interface BiblePreviewStats {
    totalVerses: number;
    totalChapters: number;
    books: string[];
    sampleVerses: Array<{
        reference: string;
        text: string;
    }>;
}

export interface BibleContentPreview {
    stats: BiblePreviewStats;
    language: string;
    sourceUri: vscode.Uri;
}

export class BibleContentAnalyzer {
    async generatePreview(fileUri: vscode.Uri, language: string): Promise<BibleContentPreview> {
        const content = await vscode.workspace.fs.readFile(fileUri);
        const textContent = Buffer.from(content).toString('utf-8');
        const lines = textContent.split('\n').filter(line => line.trim());

        const books = new Set<string>();
        const chapters = new Set<string>();
        const sampleVerses: Array<{ reference: string; text: string }> = [];
        
        // Process each line to gather statistics
        lines.forEach(line => {
            const match = line.match(/^([\w\s]+)\s+(\d+):(\d+)\s+(.+)$/);
            if (match) {
                const [_, book, chapter, verse, text] = match;
                books.add(book.trim());
                chapters.add(`${book}-${chapter}`);

                // Collect sample verses (first verse of each book up to 5 books)
                if (verse === '1' && sampleVerses.length < 5) {
                    sampleVerses.push({
                        reference: `${book} ${chapter}:${verse}`,
                        text: text.trim()
                    });
                }
            }
        });

        return {
            stats: {
                totalVerses: lines.length,
                totalChapters: chapters.size,
                books: Array.from(books),
                sampleVerses
            },
            language,
            sourceUri: fileUri
        };
    }

    async showPreviewDialog(preview: BibleContentPreview): Promise<boolean> {
        const { stats } = preview;
        
        const message = `Bible Content Preview (${preview.language})
        
📚 Books: ${stats.books.length}
📖 Chapters: ${stats.totalChapters}
📝 Verses: ${stats.totalVerses}

Sample verses:
${stats.sampleVerses.map(v => `${v.reference}: ${v.text}`).join('\n')}

Would you like to proceed with the import?`;

        const result = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            'Yes, proceed',
            'Cancel'
        );

        return result === 'Yes, proceed';
    }
}
