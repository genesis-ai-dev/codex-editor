import * as vscode from 'vscode';
import initSqlJs, { Database } from 'sql.js';
import { verseRefRegex } from "../../../utils/verseRefUtils";

interface VerseDocument {
    id: string;
    vref: string;
    book: string;
    chapter: string;
    verse: string;
    content: string;
    uri: string;
    line: number;
    isSourceBible: boolean;
}

export class VerseIndexer {
    private db: Database | null = null;
    private dbPath: vscode.Uri;

    constructor(dbPath: string) {
        this.dbPath = vscode.Uri.file(dbPath);
    }

    public async initialize(): Promise<void> {
        const SQL = await initSqlJs();
        let data: Uint8Array | null = null;

        try {
            data = await vscode.workspace.fs.readFile(this.dbPath);
        } catch (error) {
            // File doesn't exist, we'll create a new database
        }

        this.db = new SQL.Database(data);
        this.initializeDatabase();
    }

    private initializeDatabase(): void {
        this.db!.run(`
            CREATE TABLE IF NOT EXISTS verses (
                id TEXT PRIMARY KEY,
                vref TEXT,
                book TEXT,
                chapter TEXT,
                verse TEXT,
                content TEXT,
                uri TEXT,
                line INTEGER,
                isSourceBible INTEGER
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS verses_fts USING fts5(
                content,
                vref UNINDEXED,
                book UNINDEXED,
                chapter UNINDEXED,
                verse UNINDEXED
            );
        `);
    }

    public async indexDocument(document: vscode.TextDocument, isSourceBible: boolean = false): Promise<number> {
        const text = document.getText();
        const lines = text.split('\n');
        let indexedCount = 0;

        const verses: VerseDocument[] = [];
        lines.forEach((line, lineIndex) => {
            const match = line.match(verseRefRegex);
            if (match) {
                const [vref] = match;
                const [book, chapterVerse] = vref.split(' ');
                const [chapter, verse] = chapterVerse.split(':');
                const content = line.substring(match.index! + match[0].length).trim();
                const id = `${isSourceBible ? 'source' : 'target'}:${document.uri.toString()}:${lineIndex}:${vref}`;

                verses.push({
                    id,
                    vref,
                    book,
                    chapter,
                    verse,
                    content,
                    uri: document.uri.toString(),
                    line: lineIndex,
                    isSourceBible
                });
                indexedCount++;
            }
        });

        this.insertVerses(verses);
        return indexedCount;
    }

    private insertVerses(verses: VerseDocument[]): void {
        const insertVerse = this.db!.prepare(`
            INSERT OR REPLACE INTO verses (id, vref, book, chapter, verse, content, uri, line, isSourceBible)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertFTS = this.db!.prepare(`
            INSERT OR REPLACE INTO verses_fts (rowid, content, vref, book, chapter, verse)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        this.db!.exec('BEGIN TRANSACTION');

        verses.forEach((verse) => {
            insertVerse.run([
                verse.id, verse.vref, verse.book, verse.chapter, verse.verse,
                verse.content, verse.uri, verse.line, verse.isSourceBible ? 1 : 0
            ]);
            insertFTS.run([
                verse.id, verse.content, verse.vref, verse.book, verse.chapter, verse.verse
            ]);
        });

        this.db!.exec('COMMIT');

        insertVerse.free();
        insertFTS.free();

        this.saveDatabase();
    }

    public searchIndex(query: string): VerseDocument[] {
        const stmt = this.db!.prepare(`
            SELECT verses.*
            FROM verses_fts
            JOIN verses ON verses_fts.rowid = verses.id
            WHERE verses_fts MATCH ?
            ORDER BY rank
            LIMIT 5
        `);
        stmt.bind([query]);
        const results: VerseDocument[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject() as unknown as VerseDocument; // Use double assertion
            results.push(row);
        }
        stmt.free();
        return results;
    }

    public rebuildFullIndex(): void {
        this.db!.exec('DELETE FROM verses; DELETE FROM verses_fts;');
        // Implement logic to re-index all documents
        this.saveDatabase();
    }

    private async saveDatabase(): Promise<void> {
        const data = this.db!.export();
        await vscode.workspace.fs.writeFile(this.dbPath, Buffer.from(data));
    }

    public close(): void {
        if (this.db) {
            this.saveDatabase();
            this.db.close();
        }
    }

    public async indexMockDocument(): Promise<void> {
        const mockData: VerseDocument[] = [{
            id: 'mock-1',
            vref: 'Genesis 1:1',
            book: 'Genesis',
            chapter: '1',
            verse: '1',
            content: 'In the beginning God created the heaven and the earth.',
            uri: 'mock-uri',
            line: 0,
            isSourceBible: true
        }];
        this.insertVerses(mockData);
        console.log('Mock data indexed');
    }
}