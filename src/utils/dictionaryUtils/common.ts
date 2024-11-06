import { DictionaryEntry } from "../../../types";

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
    let headWord = entry.headWord || "";
    if (!headWord) {
        headWord = entry.id || "N/A";
    }

    return {
        id: entry.id || generateUniqueId(),
        headWord: headWord,
        definition: entry.definition || "",
        hash: generateHash(headWord),
    };
}

export function createDictionaryEntry(word: string): DictionaryEntry {
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
