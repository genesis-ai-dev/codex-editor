import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { SourceVerseVersions } from "../../../../../types";
import { FileData } from "./fileReaders";

export async function createSourceTextIndex(
    sourceTextIndex: MiniSearch<SourceVerseVersions>,
    sourceFiles: FileData[],
    force: boolean = false
): Promise<MiniSearch<SourceVerseVersions>> {
    const verseMap = new Map<string, { content: string; versions: string[] }>();

    // Filter for all .source files
    const allSourceFiles = sourceFiles.filter((file) => file.uri.fsPath.endsWith(".source"));

    if (allSourceFiles.length === 0) {
        console.error("No .source files found");
        return sourceTextIndex;
    }

    for (const sourceFile of allSourceFiles) {
        const version = sourceFile.uri.fsPath.split("/").pop()?.replace(".source", "") || "";

        for (const cell of sourceFile.cells) {
            if (cell.metadata?.type === "text" && cell.metadata?.id && cell.value.trim() !== "") {
                const vref = cell.metadata.id;
                if (verseMap.has(vref)) {
                    const existingVerse = verseMap.get(vref)!;
                    existingVerse.versions.push(version);
                } else {
                    verseMap.set(vref, { content: cell.value, versions: [version] });
                }
            }
        }
    }

    // Update the index with all verses from all .source files
    for (const [vref, { content, versions }] of verseMap.entries()) {
        const existingDoc = sourceTextIndex.getStoredFields(vref);
        if (
            !existingDoc ||
            existingDoc.content !== content ||
            !versions.every((v) => (existingDoc.versions as string[]).includes(v))
        ) {
            if (existingDoc) {
                sourceTextIndex.remove(vref as any);
            }
            sourceTextIndex.add({
                vref,
                content,
                versions,
            });
        }
    }

    console.log(
        `Source Bible index updated with ${sourceTextIndex.documentCount} verses from ${allSourceFiles.length} source files`
    );

    return sourceTextIndex;
}
