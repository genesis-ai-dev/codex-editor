import * as vscode from "vscode";
import { Dictionary } from "../../../types";
import { serializeDictionaryEntries, deserializeDictionaryEntries } from "./common";

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
