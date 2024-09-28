import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { SourceVerseVersions } from "../../../../../types";
import { FileData } from "./fileReaders";

export async function createSourceTextIndex(
    sourceTextIndex: MiniSearch<SourceVerseVersions>,
    sourceFiles: FileData[],
    force: boolean = false
): Promise<MiniSearch<SourceVerseVersions>> {
    const verseMap = new Map<string, { content: string; version: string }>();

    // Get the primary source Bible setting
    const config = vscode.workspace.getConfiguration("codex-project-manager");
    const primarySourceText = config.get<string>("primarySourceText");

    let selectedSourceFile: FileData | undefined;

    if (primarySourceText) {
        selectedSourceFile = sourceFiles.find((file) => file.uri.fsPath === primarySourceText);
    }

    if (!selectedSourceFile) {
        // If primary source text doesn't exist or isn't set, use the first .source file
        selectedSourceFile = sourceFiles.find((file) => file.uri.fsPath.endsWith(".source"));
    }

    if (!selectedSourceFile) {
        console.error("No suitable source Bible file found");
        return sourceTextIndex;
    }

    const version = selectedSourceFile.uri.fsPath.split("/").pop()?.replace(".source", "") || "";

    for (const cell of selectedSourceFile.cells) {
        if (cell.metadata?.type === "text" && cell.metadata?.id && cell.value.trim() !== "") {
            const vref = cell.metadata.id;
            verseMap.set(vref, { content: cell.value, version });
        }
    }

    // Instead of clearing and re-adding all documents, update only changed ones
    for (const [vref, { content, version }] of verseMap.entries()) {
        const existingDoc: Record<string, any> | undefined = sourceTextIndex.getStoredFields(vref);
        if (
            !existingDoc ||
            existingDoc.content !== content ||
            !existingDoc.versions.includes(version)
        ) {
            if (existingDoc) {
                sourceTextIndex.remove(vref as any);
            }
            sourceTextIndex.add({
                vref,
                content,
                versions: [version],
            });
        }
    }

    console.log(
        `Source Bible index updated with ${sourceTextIndex.documentCount} verses from ${version}`
    );

    return sourceTextIndex;
}
