import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

export const InputCriticalProjectInfo = ({
    vscode,
}: {
    vscode: { postMessage: (message: any) => void };
}) => {
    return (
        <div
            style={{
                display: "flex",
                gap: "10px",
                width: "100%",
                height: "100vh",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            <div
                style={{
                    display: "flex",
                    gap: "10px",
                    marginBottom: "37vh",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                }}
            >
                <i className="codicon codicon-symbol-variable" style={{ fontSize: "72px" }}></i>
                <VSCodeButton
                    onClick={() => {
                        vscode.postMessage({
                            command: "renameProject",
                        });
                    }}
                >
                    Name Project <i className="codicon codicon-arrow-right"></i>
                </VSCodeButton>
                <VSCodeButton
                    onClick={() => {
                        vscode.postMessage({
                            command: "changeSourceLanguage",
                        });
                    }}
                >
                    Source Language <i className="codicon codicon-arrow-right"></i>
                </VSCodeButton>
                <VSCodeButton
                    onClick={() => {
                        vscode.postMessage({
                            command: "changeTargetLanguage",
                        });
                    }}
                >
                    Target Language <i className="codicon codicon-arrow-right"></i>
                </VSCodeButton>
            </div>
        </div>
    );
};
