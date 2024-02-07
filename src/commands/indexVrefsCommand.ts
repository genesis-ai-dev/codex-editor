import * as vscode from "vscode";
import { client } from "../meilisearchClient";
import { findVerseRef } from "../utils/verseRefUtils";
import { getFullListOfOrgVerseRefs } from "../utils";

export async function indexVrefs() {
    const orgVerseRefsSet = new Set(getFullListOfOrgVerseRefs()); // Convert list to a Set for faster lookup
    try {
        const files = await vscode.workspace.findFiles(
            "resources/**",
            "**/*.bible",
        ); // Adjust the glob pattern to match your files
        const documentsToIndex: {
            id: string;
            vref: string;
            uri: string;
            position: { line: number; character: number };
        }[] = [];

        // Use Promise.all to process files in parallel
        await Promise.all(
            files.map(async (file) => {
                try {
                    const document =
                        await vscode.workspace.openTextDocument(file);
                    const text = document.getText();
                    const lines = text.split(/\r?\n/);

                    lines.forEach((line, lineIndex) => {
                        // Extract potential verse references from the line
                        const potentialVrefs = extractPotentialVrefs(line); // Implement this based on your pattern
                        potentialVrefs.forEach((vref) => {
                            if (orgVerseRefsSet.has(vref)) {
                                // Add to documentsToIndex
                                documentsToIndex.push({
                                    id: `${file.fsPath.replace(
                                        /[^a-zA-Z0-9-_]/g,
                                        "_",
                                    )}_${lineIndex}_${line.indexOf(vref)}`,
                                    vref: vref,
                                    uri: file.fsPath,
                                    position: {
                                        line: lineIndex,
                                        character: line.indexOf(vref),
                                    },
                                });
                            }
                        });
                    });
                } catch (error) {
                    console.error(
                        `Error processing file ${file.fsPath}: ${error}`,
                    );
                }
            }),
        );

        // After collecting documents, batch them to Meilisearch
        const index = client.index("vrefs"); // Replace 'vrefs' with your chosen index name
        // Consider batching if documentsToIndex is large
        await index.deleteAllDocuments();
        if (documentsToIndex.length > 0) {
            await index
                .addDocuments(documentsToIndex)
                .then((res) => console.log(res));
        }

        vscode.window.showInformationMessage(
            "Indexing of verse references completed successfully.",
        );
    } catch (error) {
        console.error(`Error indexing documents: ${error}`);
    }
}

function extractPotentialVrefs(line: string): string[] {
    const verseRefPattern = /\b(?:[1-3]\s)?[A-Za-z]+(?:\s\d+:\d+(-\d+)?)/g;
    // fixme: Ryder, expand this search
    const matches = line.match(verseRefPattern);
    return matches || [];
}

export async function checkTaskStatus(taskUid: number) {
    try {
        const status = await client.getTask(taskUid);
        console.log(status); // Log the current status of the task
        if (status.status === "succeeded") {
            vscode.window.showInformationMessage(
                "Indexing completed successfully.",
            );
        } else if (status.status === "failed") {
            vscode.window.showErrorMessage("Indexing failed: " + status.error);
            console.log({ status });
        } else {
            // If the task is still processing, you might want to check again later
            console.log("Task is still processing...");
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(
            "Error fetching task status: " + error.message,
        );
    }
}
