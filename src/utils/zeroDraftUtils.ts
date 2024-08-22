import * as vscode from 'vscode';
import { ZeroDraftIndexRecord } from '../activationHelpers/contextAware/server/indexes/zeroDraftIndex';
import { verseRefRegex } from './verseRefUtils';

export function zeroDraftDocumentLoader(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    const fileExtension = document.uri.fsPath.split('.').pop()?.toLowerCase();
    let records: ZeroDraftIndexRecord[] = [];

    switch (fileExtension) {
        case 'txt':
            records = loadTxtDocument(document);
            break;
        case 'json':
            records = loadJsonDocument(document);
            break;
        case 'jsonl':
            records = loadJsonlDocument(document);
            break;
        case 'tsv':
            records = loadTsvDocument(document);
            break;
        default:
            console.warn(`Unsupported file type: ${fileExtension}`);
    }

    console.log(`Loaded ${records.length} records from ${document.uri.fsPath}`);
    return records;
}

function loadTxtDocument(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    return document.getText().split('\n')
        .map(line => {
            const match = line.trim().match(verseRefRegex);
            if (match) {
                const vref = match[0];
                const content = line.trim().slice(vref.length).trim();
                if (vref && content) {
                    return { vref, content };
                }
            }
            return null;
        })
        .filter((parts): parts is { vref: string; content: string } => parts !== null)
        .map(({ vref, content }) => ({
            id: vref,
            vref,
            verses: [{
                content,
                source: document.uri.fsPath,
                uploadedAt: new Date().toISOString(),
                originalFileCreatedAt: '',
                originalFileModifiedAt: ''
            }]
        }));
}

function loadJsonDocument(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    try {
        const content = JSON.parse(document.getText());
        if (Array.isArray(content)) {
            return content.map(item => {
                const match = item.vref.match(verseRefRegex);
                const vref = match ? match[0] : item.vref;
                return {
                    id: vref,
                    vref,
                    verses: [{
                        content: item.content,
                        source: document.uri.fsPath,
                        uploadedAt: new Date().toISOString(),
                        originalFileCreatedAt: item.originalFileCreatedAt || '',
                        originalFileModifiedAt: item.originalFileModifiedAt || '',
                        metadata: item.metadata
                    }]
                };
            });
        }
    } catch (error) {
        console.error('Error parsing JSON document:', error);
    }
    return [];
}

function loadJsonlDocument(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    return document.getText().split('\n')
        .filter(line => line.trim())
        .map(line => {
            try {
                const item = JSON.parse(line);
                const match = item.vref.match(verseRefRegex);
                const vref = match ? match[0] : item.vref;
                return {
                    id: vref,
                    vref,
                    verses: [{
                        content: item.content,
                        source: document.uri.fsPath,
                        uploadedAt: new Date().toISOString(),
                        originalFileCreatedAt: item.originalFileCreatedAt || '',
                        originalFileModifiedAt: item.originalFileModifiedAt || '',
                        metadata: item.metadata || {} // Ensure metadata is always an object
                    }]
                } as ZeroDraftIndexRecord;
            } catch (error) {
                console.error('Error parsing JSONL line:', error);
                return null;
            }
        })
        .filter((item): item is ZeroDraftIndexRecord => item !== null);
}

function loadTsvDocument(document: vscode.TextDocument): ZeroDraftIndexRecord[] {
    return document.getText().split('\n')
        .map(line => {
            const parts = line.trim().split('\t');
            if (parts.length >= 2) {
                const match = parts[0].match(verseRefRegex);
                const vref = match ? match[0] : parts[0];
                const content = parts[1];
                const metadataFields = parts.slice(2);
                return {
                    id: vref,
                    vref,
                    verses: [{
                        content,
                        source: document.uri.fsPath,
                        uploadedAt: new Date().toISOString(),
                        originalFileCreatedAt: '',
                        originalFileModifiedAt: '',
                        metadata: metadataFields.reduce<{ [key: string]: string }>((acc, field, index) => {
                            acc[`field${index + 1}`] = field;
                            return acc;
                        }, {})
                    }]
                } as ZeroDraftIndexRecord;
            }
            return null;
        })
        .filter((item): item is NonNullable<ZeroDraftIndexRecord> => item !== null);
}