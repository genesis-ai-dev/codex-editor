import * as vscode from "vscode";
import { client } from "../meilisearchClient";
import { findVerseRef } from "../utils/verseRefUtils";
import { getFullListOfOrgVerseRefs } from "../utils";

export async function indexVrefs() {
    const orgVerseRefs = getFullListOfOrgVerseRefs();
    console.log({ orgVerseRefs });
    try {
        const files = await vscode.workspace.findFiles("resources/**"); // Adjust the glob pattern to match your files
        const documentsToIndex = [];
        console.log({ files });
        for (const file of files) {
            try {
                const document = await vscode.workspace.openTextDocument(file);
                const text = document.getText();
                const lines = text.split(/\r?\n/);

                // optimize: check the full content of each file for vrefs first. If any are vrefs are found then add the file to an array of files with vrefs.
                // The array should contain objects with the file path and the vrefs in the file.
                // A second pass should be done to find the position of those vrfs in the file.

                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    for (
                        let orgVerseRefIndex = 0;
                        orgVerseRefIndex < orgVerseRefs.length;
                        orgVerseRefIndex++
                    ) {
                        const { verseRefWasFound, verseRefInContentFormat } =
                            findVerseRef({
                                verseRef: orgVerseRefs[orgVerseRefIndex], // Adjust this to match how vrefs are identified in your content
                                content: lines[lineIndex],
                            });

                        if (verseRefWasFound) {
                            console.log({
                                verseRefWasFound,
                                verseRefInContentFormat,
                            });
                            documentsToIndex.push({
                                // Replace all non-alphanumeric characters with underscores
                                id: `${file.fsPath.replace(
                                    /[^a-zA-Z0-9-_]/g,
                                    "_",
                                )}_${lineIndex}_${lines[lineIndex].indexOf(
                                    verseRefInContentFormat,
                                )}`,
                                vref: verseRefInContentFormat,
                                uri: file.fsPath,
                                position: {
                                    line: lineIndex,
                                    character: lines[lineIndex].indexOf(
                                        verseRefInContentFormat,
                                    ),
                                },
                            });
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing file ${file.fsPath}: ${error}`);
            }
        }
        console.log({ documentsToIndex });
        const index = client.index("vrefs"); // Replace 'vrefs' with your chosen index name
        // Clear the index before adding new documents
        await index.deleteAllDocuments();

        await index
            .addDocuments(documentsToIndex)
            .then((res) => console.log(res));
        vscode.window.showInformationMessage(
            "Indexing of verse references completed successfully.",
        );
    } catch (error) {
        console.error(`Error indexing documents: ${error}`);
    }
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
