import { useCallback, useEffect, useState } from "react";
import { SourceUploadResponseMessages } from "../../../../../types";
import { WorkflowState } from "../types";

const vscode = acquireVsCodeApi();
const initialWorkflowState: WorkflowState = {
    step: "type-select",
    selectedFile: null,
    processingStages: {},
    importType: null,
};

export function useVSCodeMessageHandler() {
    const [workflow, setWorkflow] = useState<WorkflowState>(initialWorkflowState);

    const handleMessage = useCallback(
        (event: MessageEvent<SourceUploadResponseMessages>) => {
            const message = event.data;

            switch (message.command) {
                case "sourcePreview":
                    if (message.preview) {
                        setWorkflow((prev) => ({
                            ...prev,
                            step: "preview",
                            preview: message.preview,
                        }));
                    }
                    break;

                case "updateProcessingStatus":
                    if (message.status) {
                        setWorkflow((prev: WorkflowState) => ({
                            ...prev,
                            step: "processing",
                            processingStages: Object.entries(message.status || {}).reduce(
                                (acc, [key, status]) => ({
                                    ...acc,
                                    [key]: {
                                        ...prev.processingStages[key],
                                        status,
                                    },
                                }),
                                prev.processingStages
                            ),
                        }));
                    }
                    break;

                case "importComplete":
                    setWorkflow((prev: WorkflowState) => ({
                        ...prev,
                        step: "complete",
                    }));
                    break;

                case "error":
                    setWorkflow((prev: WorkflowState) => ({
                        ...prev,
                        error: message.message,
                    }));
                    break;
            }
        },
        [setWorkflow]
    );

    useEffect(() => {
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [handleMessage]);

    return { vscode, workflow, setWorkflow };
}
