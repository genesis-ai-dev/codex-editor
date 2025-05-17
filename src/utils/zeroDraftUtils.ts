import * as vscode from "vscode";
import {
    ZeroDraftIndexRecord,
    CellWithMetadata,
} from "../activationHelpers/contextAware/miniIndex/indexes/zeroDraftIndex";
import { verseRefRegex } from "./verseRefUtils";
import { WebPathUtils } from './webPathUtils';

export interface ZeroDraftRecord {
    id: string;
    content: string;
    source: string;
    timestamp: number;
}

export function zeroDraftDocumentLoader(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    const fileExtension = WebPathUtils.getExtension(document.uri);
    let records: ZeroDraftIndexRecord[] = [];

    switch (fileExtension) {
        case "txt":
            records = loadTxtDocument(document);
            break;
        case "json":
            records = loadJsonDocument(document);
            break;
        case "jsonl":
            records = loadJsonlDocument(document);
            break;
        case "tsv":
            records = loadTsvDocument(document);
            break;
        default:
            console.warn(`Unsupported file type: ${fileExtension}`);
    }

    console.log(`Loaded ${records.length} records from ${document.uri.toString()}`);
    return records;
}

function loadTxtDocument(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    return document
        .getText()
        .split("\n")
        .map((line) => {
            const match = line.trim().match(verseRefRegex);
            if (match) {
                const cellId = match[0];
                const content = line.trim().slice(cellId.length).trim();
                if (cellId && content) {
                    return { cellId, content };
                }
            }
            return null;
        })
        .filter((parts): parts is { cellId: string; content: string } => parts !== null)
        .map(({ cellId, content }) => ({
            id: cellId,
            cellId,
            cells: [
                {
                    content,
                    source: document.uri.toString(),
                    uploadedAt: new Date().toISOString(),
                    originalFileCreatedAt: "",
                    originalFileModifiedAt: "",
                },
            ],
        }));
}

function loadJsonDocument(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    try {
        const content = JSON.parse(document.getText());
        if (Array.isArray(content)) {
            return content.map((item) => {
                const match = item.cellId.match(verseRefRegex);
                const cellId = match ? match[0] : item.cellId;
                return {
                    id: cellId,
                    cellId,
                    cells: [
                        {
                            content: item.content,
                            source: document.uri.toString(),
                            uploadedAt: new Date().toISOString(),
                            originalFileCreatedAt: item.originalFileCreatedAt || "",
                            originalFileModifiedAt: item.originalFileModifiedAt || "",
                            metadata: item.metadata,
                        },
                    ],
                };
            });
        }
    } catch (error) {
        console.error("Error parsing JSON document:", error);
    }
    return [];
}

function loadJsonlDocument(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    return document
        .getText()
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
            try {
                const item = JSON.parse(line);
                const match = item.cellId.match(verseRefRegex);
                const cellId = match ? match[0] : item.cellId;
                return {
                    id: cellId,
                    cellId,
                    cells: [
                        {
                            content: item.content,
                            source: document.uri.toString(),
                            uploadedAt: new Date().toISOString(),
                            originalFileCreatedAt: item.originalFileCreatedAt || "",
                            originalFileModifiedAt: item.originalFileModifiedAt || "",
                            metadata: item.metadata || {},
                        },
                    ],
                } as ZeroDraftIndexRecord;
            } catch (error) {
                console.error("Error parsing JSONL line:", error);
                return null;
            }
        })
        .filter((item): item is ZeroDraftIndexRecord => item !== null);
}

function loadTsvDocument(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    return document
        .getText()
        .split("\n")
        .map((line) => {
            const parts = line.trim().split("\t");
            if (parts.length >= 2) {
                const match = parts[0].match(verseRefRegex);
                const cellId = match ? match[0] : parts[0];
                const content = parts[1];
                const metadataFields = parts.slice(2);
                return {
                    id: cellId,
                    cellId,
                    cells: [
                        {
                            content,
                            source: document.uri.toString(),
                            uploadedAt: new Date().toISOString(),
                            originalFileCreatedAt: "",
                            originalFileModifiedAt: "",
                            metadata: metadataFields.reduce<{ [key: string]: string }>(
                                (acc, field, index) => {
                                    acc[`field${index + 1}`] = field;
                                    return acc;
                                },
                                {}
                            ),
                        },
                    ],
                } as ZeroDraftIndexRecord;
            }
            return null;
        })
        .filter((item): item is NonNullable<ZeroDraftIndexRecord> => item !== null);
}

export async function loadZeroDrafts(document: vscode.TextDocument): Promise<ZeroDraftRecord[]> {
    const fileExtension = WebPathUtils.getExtension(document.uri);
    if (fileExtension !== 'codex') {
        return [];
    }

    try {
        const content = await vscode.workspace.fs.readFile(document.uri);
        const text = new TextDecoder().decode(content);
        const records: ZeroDraftRecord[] = [];

        // Parse the content and extract zero drafts
        const lines = text.split('\n');
        for (const line of lines) {
            if (line.trim().startsWith('<!-- ZeroDraft:')) {
                try {
                    const record = JSON.parse(line.replace('<!-- ZeroDraft:', '').replace('-->', ''));
                    records.push({
                        ...record,
                        source: document.uri.toString(),
                    });
                } catch (e) {
                    console.warn('Failed to parse zero draft record:', e);
                }
            }
        }

        console.log(`Loaded ${records.length} records from ${document.uri.toString()}`);
        return records;
    } catch (error) {
        console.error('Error loading zero drafts:', error);
        return [];
    }
}

export async function saveZeroDraft(
    document: vscode.TextDocument,
    content: string,
    id: string
): Promise<void> {
    const fileExtension = WebPathUtils.getExtension(document.uri);
    if (fileExtension !== 'codex') {
        return;
    }

    try {
        const existingContent = await vscode.workspace.fs.readFile(document.uri);
        const text = new TextDecoder().decode(existingContent);
        const lines = text.split('\n');

        const record: ZeroDraftRecord = {
            id,
            content,
            source: document.uri.toString(),
            timestamp: Date.now(),
        };

        // Add the zero draft record
        lines.push(`<!-- ZeroDraft:${JSON.stringify(record)}-->`);

        // Write back to the file
        await vscode.workspace.fs.writeFile(
            document.uri,
            new TextEncoder().encode(lines.join('\n'))
        );
    } catch (error) {
        console.error('Error saving zero draft:', error);
    }
}
