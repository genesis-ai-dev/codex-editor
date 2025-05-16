import React, { useState } from "react";
import { VSCodeButton, VSCodeTextField, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { ProjectSelectionState, ProjectSelectionType } from "../types";

interface ProjectPickerProps {
    projectSelection: ProjectSelectionState;
    onProjectSelected: () => void;
    vscode: any;
}

export const ProjectPicker: React.FC<ProjectPickerProps> = ({
    projectSelection,
    onProjectSelected,
    vscode,
}) => {
    const [selectedType, setSelectedType] = useState<ProjectSelectionType | undefined>(
        projectSelection.type
    );
    const [repoUrl, setRepoUrl] = useState(projectSelection.repoUrl || "");

    const handleCloneProject = () => {
        vscode.postMessage({
            command: "project.clone",
            repoUrl,
        });
    };

    const handleOpenProject = () => {
        vscode.postMessage({
            command: "project.open",
        });
    };

    const handleNewProject = () => {
        vscode.postMessage({
            command: "project.new",
        });
    };

    return (
        <div style={{ maxWidth: "600px", margin: "0 auto", padding: "2rem" }}>
            <h2>Select or Create a Project</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                <div>
                    <VSCodeButton
                        appearance={selectedType === "clone" ? "primary" : "secondary"}
                        onClick={() => setSelectedType("clone")}
                    >
                        Clone Remote Project
                    </VSCodeButton>

                    {selectedType === "clone" && (
                        <div style={{ marginTop: "1rem" }}>
                            <VSCodeTextField
                                value={repoUrl}
                                onChange={(e) => setRepoUrl((e.target as HTMLInputElement).value)}
                                placeholder="Enter repository URL"
                                style={{ width: "100%" }}
                            />
                            <VSCodeButton
                                style={{ marginTop: "0.5rem" }}
                                disabled={!repoUrl}
                                onClick={handleCloneProject}
                            >
                                Clone Repository
                            </VSCodeButton>
                        </div>
                    )}
                </div>

                <VSCodeDivider />

                <div>
                    <VSCodeButton
                        appearance={selectedType === "open" ? "primary" : "secondary"}
                        onClick={() => {
                            setSelectedType("open");
                            handleOpenProject();
                        }}
                    >
                        Open Local Project
                    </VSCodeButton>
                </div>

                <VSCodeDivider />

                <div>
                    <VSCodeButton
                        appearance={selectedType === "new" ? "primary" : "secondary"}
                        onClick={() => {
                            setSelectedType("new");
                            handleNewProject();
                        }}
                    >
                        Create New Project
                    </VSCodeButton>
                </div>
            </div>

            {projectSelection.error && (
                <div
                    style={{
                        color: "var(--vscode-errorForeground)",
                        marginTop: "1rem",
                    }}
                >
                    {projectSelection.error}
                </div>
            )}
        </div>
    );
};
