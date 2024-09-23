import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { SourceVerseVersions } from "../../../../../types";
import { FileData } from "./fileReaders";

export async function createSourceBibleIndex(
    sourceBibleIndex: MiniSearch<SourceVerseVersions>,
    sourceFiles: FileData[],
    force: boolean = false
): Promise<MiniSearch<SourceVerseVersions>> {
    const verseMap = new Map<string, { content: string; version: string }>();

    // Get the primary source Bible setting
    const config = vscode.workspace.getConfiguration("codex-project-manager");
    const primarySourceBible = config.get<string>("primarySourceBible");

    let selectedSourceFile: FileData | undefined;

    if (primarySourceBible) {
        selectedSourceFile = sourceFiles.find((file) => file.uri.fsPath === primarySourceBible);
    }

    if (!selectedSourceFile) {
        // If primary source Bible doesn't exist or isn't set, use the first .bible file
        selectedSourceFile = sourceFiles.find((file) => file.uri.fsPath.endsWith(".bible"));
    }

    if (!selectedSourceFile) {
        console.error("No suitable source Bible file found");
        return sourceBibleIndex;
    }

    const version = selectedSourceFile.uri.fsPath.split("/").pop()?.replace(".bible", "") || "";

    for (const cell of selectedSourceFile.cells) {
        if (cell.metadata?.type === "text" && cell.metadata?.id && cell.value.trim() !== "") {
            const vref = cell.metadata.id;
            verseMap.set(vref, { content: cell.value, version });
        }
    }

    const documents = Array.from(verseMap.entries()).map(([vref, { content, version }]) => ({
        id: vref,
        vref,
        content,
        versions: [version],
    }));

    sourceBibleIndex.removeAll(); // Clear existing index before adding new documents
    sourceBibleIndex.addAll(documents);
    console.log(
        `Source Bible index created with ${sourceBibleIndex.documentCount} verses from ${version}`
    );

    return sourceBibleIndex;
}
