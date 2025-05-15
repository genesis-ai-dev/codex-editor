import * as vscode from "vscode";
import { cleanWord } from "../cleaningUtils";
import {
    serializeDictionaryEntries,
    deserializeDictionaryEntries,
    createDictionaryEntry,
} from "./common";
import { Dictionary } from "../../../types";

// todo: this is probably not needed anymore

export async function readDictionaryServer(path: string): Promise<Dictionary> {
    try {
        const fileUri = vscode.Uri.file(path);
        const content = await vscode.workspace.fs.readFile(fileUri);
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

export async function saveDictionaryServer(path: string, dictionary: Dictionary): Promise<void> {
    const content = serializeDictionaryEntries(dictionary.entries);
    const fileUri = vscode.Uri.file(path);
    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
}

export async function addWordsToDictionary(path: string, words: string[]): Promise<void> {
    const dictionary = await readDictionaryServer(path);
    const newEntries = words
        .map(cleanWord)
        .filter((word) => word && !dictionary.entries.some((entry) => entry.headWord === word))
        .map((word) => createDictionaryEntry(word));

    dictionary.entries.push(...newEntries);
    await saveDictionaryServer(path, dictionary);
}
