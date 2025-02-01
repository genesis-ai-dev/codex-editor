import React, { useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { ImportType } from "../types";

interface CodexFile {
    id: string;
    name: string;
    path: string;
}

interface TranslationFileAssociation {
    file: File;
    codexId: string | null;
}

interface FileDropzoneProps {
    onDrop: (files: File[]) => void;
    selectedFiles: File[];
    onClearFiles: () => void;
    onRemoveFile: (file: File) => void;
    type: ImportType | null;
    availableCodexFiles?: CodexFile[];
    onAssociationChange?: (associations: Array<{ file: File; codexId: string }>) => void;
    accept?: string;
}

function calculateStringSimilarity(str1: string, str2: string): number {
    // Convert both strings to lowercase and remove extensions
    const normalize = (s: string) => s.toLowerCase().replace(/\.[^/.]+$/, "");
    const s1 = normalize(str1);
    const s2 = normalize(str2);

    // Calculate Levenshtein distance
    const matrix = Array(s2.length + 1)
        .fill(null)
        .map(() => Array(s1.length + 1).fill(null));

    for (let i = 0; i <= s1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= s2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= s2.length; j++) {
        for (let i = 1; i <= s1.length; i++) {
            const substitute = matrix[j - 1][i - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1);
            matrix[j][i] = Math.min(
                substitute,
                matrix[j - 1][i] + 1, // deletion
                matrix[j][i - 1] + 1 // insertion
            );
        }
    }

    // Convert distance to similarity score (0-1)
    const maxLength = Math.max(s1.length, s2.length);
    return 1 - matrix[s2.length][s1.length] / maxLength;
}

function findBestCodexMatch(
    file: File,
    availableCodexFiles: CodexFile[],
    usedCodexIds: Set<string>
): CodexFile | null {
    let bestMatch: CodexFile | null = null;
    let bestSimilarity = 0;
    const SIMILARITY_THRESHOLD = 0.5; // Minimum similarity score to consider a match

    for (const codexFile of availableCodexFiles) {
        if (usedCodexIds.has(codexFile.id)) continue;

        const similarity = calculateStringSimilarity(file.name, codexFile.name);
        if (similarity > bestSimilarity && similarity >= SIMILARITY_THRESHOLD) {
            bestSimilarity = similarity;
            bestMatch = codexFile;
        }
    }

    return bestMatch;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
    onDrop,
    selectedFiles,
    onClearFiles,
    onRemoveFile,
    type,
    availableCodexFiles = [],
    onAssociationChange,
    accept,
}) => {
    const [associations, setAssociations] = useState<TranslationFileAssociation[]>([]);

    // Effect to notify parent of valid associations whenever they change
    useEffect(() => {
        if (type === "translation" && associations.length > 0) {
            const validAssociations = associations
                .filter((a) => a.codexId !== null)
                .map((a) => ({
                    file: a.file,
                    codexId: a.codexId!,
                }));

            if (validAssociations.length > 0) {
                onAssociationChange?.(validAssociations);
            }
        }
    }, [associations, type, onAssociationChange]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: (files) => {
            if (type === "translation") {
                // Try to automatically match files with codex files
                const newAssociations: TranslationFileAssociation[] = [];
                const usedCodexIds = new Set<string>();

                files.forEach((file) => {
                    const bestMatch = findBestCodexMatch(file, availableCodexFiles, usedCodexIds);
                    if (bestMatch) {
                        usedCodexIds.add(bestMatch.id);
                    }
                    newAssociations.push({
                        file,
                        codexId: bestMatch?.id || null,
                    });
                });

                setAssociations(newAssociations);
            }
            onDrop(files);
        },
        noClick: false,
        noKeyboard: false,
        preventDropOnDocument: true,
        onDragOver: (event) => {
            event.preventDefault();
        },
        onDragEnter: (event) => {
            event.preventDefault();
        },
    });

    // Track which codex files are already associated
    const usedCodexIds = new Set(associations.map((a) => a.codexId).filter(Boolean));
    const availableCodexChoices = availableCodexFiles.filter((f) => !usedCodexIds.has(f.id));

    const handleAssociationChange = (fileIndex: number, codexId: string) => {
        const newAssociations = associations.map((assoc, idx) =>
            idx === fileIndex ? { ...assoc, codexId } : assoc
        );
        setAssociations(newAssociations);

        // Notify parent of ALL valid associations
        const validAssociations = newAssociations
            .filter((a) => a.codexId)
            .map((a) => ({ file: a.file, codexId: a.codexId! }));

        onAssociationChange?.(validAssociations);
    };

    const handleClear = () => {
        setAssociations([]);
        onClearFiles();
    };

    const handleRemoveFile = (file: File) => {
        // Remove association if it exists
        if (type === "translation") {
            setAssociations((prev) => prev.filter((a) => a.file !== file));
        }
        onRemoveFile(file);
    };

    return (
        <div>
            {/* <div
                {...getRootProps()}
                style={{
                    border: "1px dashed var(--vscode-button-border)",
                    borderRadius: "4px",
                    padding: "2rem",
                    cursor: "pointer",
                    marginBottom: selectedFiles.length ? "1rem" : 0,
                }}
            >
                <input {...getInputProps({ multiple: true })} />
                {selectedFiles.length === 0 && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "1rem",
                        }}
                    >
                        <i
                            className="codicon codicon-cloud-upload"
                            style={{ fontSize: "2rem" }}
                        ></i>
                        <p>
                            {isDragActive
                                ? "Drop the files here"
                                : `Drag and drop your ${type} files here`}
                        </p>
                        <p
                            style={{
                                color: "var(--vscode-descriptionForeground)",
                                fontSize: "0.9em",
                            }}
                        >
                            or click to select files
                        </p>
                    </div>
                )}
            </div> */}

            <div
                {...getRootProps()}
                style={{
                    display: "flex",
                    justifyContent: "center",
                    marginBottom: selectedFiles.length ? "1rem" : 0,
                }}
            >
                <input {...getInputProps({ multiple: true })} />
                {selectedFiles.length === 0 && (
                    <VSCodeButton>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                            }}
                        >
                            <i className="codicon codicon-cloud-upload"></i>
                            <span>Select {type} files</span>
                        </div>
                    </VSCodeButton>
                )}
            </div>

            {selectedFiles.length > 0 && (
                <div
                    style={{
                        background: "var(--vscode-editor-background)",
                        borderRadius: "4px",
                        padding: "1rem",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "1rem",
                        }}
                    >
                        <h4 style={{ margin: 0 }}>Selected Files</h4>
                        <VSCodeButton appearance="secondary" onClick={handleClear}>
                            Clear All
                        </VSCodeButton>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        {type === "translation"
                            ? associations.map((assoc, index) => (
                                  <div
                                      key={index}
                                      style={{
                                          display: "flex",
                                          gap: "1rem",
                                          alignItems: "center",
                                          padding: "0.5rem",
                                          background: "var(--vscode-input-background)",
                                          borderRadius: "4px",
                                      }}
                                  >
                                      <div style={{ flex: 1 }}>
                                          {assoc.file.name} ({(assoc.file.size / 1024).toFixed(2)}{" "}
                                          KB)
                                      </div>
                                      <VSCodeDropdown
                                          style={{ width: "300px" }}
                                          value={assoc.codexId || ""}
                                          onChange={(e: any) =>
                                              handleAssociationChange(index, e.target.value)
                                          }
                                      >
                                          <VSCodeOption value="">Select Codex file...</VSCodeOption>
                                          {[
                                              // Always include currently selected codex
                                              ...(assoc.codexId
                                                  ? availableCodexFiles.filter(
                                                        (f) => f.id === assoc.codexId
                                                    )
                                                  : []),
                                              // Add remaining available choices
                                              ...availableCodexChoices,
                                          ].map((file) => (
                                              <VSCodeOption key={file.id} value={file.id}>
                                                  {file.name}
                                              </VSCodeOption>
                                          ))}
                                      </VSCodeDropdown>
                                  </div>
                              ))
                            : selectedFiles.map((file, index) => (
                                  <div
                                      key={index}
                                      style={{
                                          padding: "0.5rem",
                                          background: "var(--vscode-input-background)",
                                          borderRadius: "4px",
                                      }}
                                  >
                                      {file.name} ({(file.size / 1024).toFixed(2)} KB)
                                  </div>
                              ))}
                    </div>
                </div>
            )}
            {selectedFiles.length > 0 && type === "translation" && (
                <div
                    style={{
                        marginTop: "0.5rem",
                        color: "var(--vscode-descriptionForeground)",
                        fontSize: "0.9em",
                    }}
                >
                    {associations.some((a) => a.codexId)
                        ? `${
                              associations.filter((a) => a.codexId).length
                          } files automatically matched`
                        : "No automatic matches found - please select codex files manually"}
                </div>
            )}
        </div>
    );
};
