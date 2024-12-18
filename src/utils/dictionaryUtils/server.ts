import * as fs from "fs";

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

export async function addWordsToDictionary(path: string, words: string[]): Promise<void> {
    const dictionary = await readDictionaryServer(path);
    const newEntries = words
        .map(cleanWord)
        .filter((word) => word && !dictionary.entries.some((entry) => entry.headWord === word))
        .map((word) => createDictionaryEntry(word));

    dictionary.entries.push(...newEntries);
    await saveDictionaryServer(path, dictionary);
}
