import * as fs from "fs"; // Need to use fs because the server uses this too
import * as vscode from "vscode";
import { Dictionary, DictionaryEntry } from "../../types";
import { cleanWord } from "./cleaningUtils";

// Server version (using fs)
export async function readDictionaryServer(path: string): Promise<Dictionary> {
    try {
        const content = await fs.promises.readFile(path, "utf-8");
        const entries = deserializeDictionaryEntries(content);
        return {
            id: "project",
            label: "Project",
            entries,
            metadata: {},
        };
    } catch (error) {
        console.error("Error reading dictionary:", error);
        return { id: "project", label: "Project", entries: [], metadata: {} };
    }
}

export async function saveDictionaryServer(path: string, dictionary: Dictionary): Promise<void> {
    const content = serializeDictionaryEntries(dictionary.entries);
    await fs.promises.writeFile(path, content, "utf-8");
}

// Client version (using vscode.workspace.fs)
export async function readDictionaryClient(uri: vscode.Uri): Promise<Dictionary> {
    try {
        const content = await vscode.workspace.fs.readFile(uri);
        const entries = deserializeDictionaryEntries(new TextDecoder().decode(content));
        return {
            id: "project",
            label: "Project",
            entries,
            metadata: {},
        };
    } catch (error) {
        console.error("Error reading dictionary:", error);
        return { id: "project", label: "Project", entries: [], metadata: {} };
    }
}

export async function saveDictionaryClient(uri: vscode.Uri, dictionary: Dictionary): Promise<void> {
    const content = serializeDictionaryEntries(dictionary.entries);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
}

export async function addWordsToDictionary(path: string, words: string[]): Promise<void> {
    const dictionary = await readDictionaryServer(path);
    const newEntries = words
        .map(cleanWord)
        .filter(
            (word) =>
                word &&
                !dictionary.entries.some(
                    (entry) => entry.headWord?.toLowerCase() === word.toLowerCase()
                )
        )
        .map((word) => createDictionaryEntry(word));

    dictionary.entries.push(...newEntries);
    await saveDictionaryServer(path, dictionary);
}

export function serializeDictionaryEntries(entries: DictionaryEntry[]): string {
    return entries.map((entry) => JSON.stringify(ensureCompleteEntry(entry))).join("\n") + "\n";
}

export function deserializeDictionaryEntries(content: string): DictionaryEntry[] {
    return content
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line))
        .map(ensureCompleteEntry);
}

export function repairDictionaryContent(content: string): string {
    return content.replace(/}\s*{/g, "}\n{");
}

export function ensureCompleteEntry(entry: Partial<DictionaryEntry>): DictionaryEntry {
    return {
        id: entry.id || generateUniqueId(),
        headWord: entry.headWord || "N/A",
        definition: entry.definition || "",
        hash: entry.hash || generateHash(entry.headWord || ""),
    };
}

function createDictionaryEntry(word: string): DictionaryEntry {
    return {
        id: generateUniqueId(),
        headWord: word,
        definition: "",
        hash: generateHash(word),
    };
}

function generateUniqueId(): string {
    return Math.random().toString(36).substr(2, 9);
}

function generateHash(word: string): string {
    return word
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), 0)
        .toString();
}
