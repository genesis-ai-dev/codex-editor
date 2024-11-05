import React, { useState } from "react";
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";

type ContextItemListProps = {
    contextItems: string[];
    vscode: any;
    sourceCellMap: { [k: string]: { content: string; versions: string[] } };
};

export const ContextItemList: React.FC<ContextItemListProps> = ({
    contextItems,
    vscode,
    sourceCellMap,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true);

    const toggleCollapse = () => setIsCollapsed(isCollapsed);

    const openContextItem = (item: string) => {
        vscode.postMessage({
            command: "openContextItem",
            text: item,
            // FIXME: I'm just going to check the string for 'Notes' or 'Questions' respectively, and open the webview for the appropriate one.
            // This is a serious hack. I should be passing the context item type as well, and that should be passed in from a more sophisticated context object other than a string.
        });
    };

    const renderSourceCellContent = (cellId: string, cellContent: string) => {
        if (cellContent) {
            return (
                <div
                    style={{
                        marginTop: "0.25em",
                        fontSize: "0.9em",
                        color: "var(--vscode-descriptionForeground)",
                    }}
                >
                    {cellId}: {cellContent.slice(0, 100)}...
                </div>
            );
        }
        return null;
    };

    return (
        (contextItems.length > 0 || Object.keys(sourceCellMap).length > 0) && (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25em",
                    width: "100%",
                    fontSize: "0.6em",
                }}
            >
                <VSCodeLink onClick={toggleCollapse}>
                    <i className="codicon codicon-quote" title="Context Items"></i>
                    {isCollapsed && contextItems.length > 0
                        ? "Source Cell Content"
                        : "Hide Source Cell Content"}
                </VSCodeLink>
                {!isCollapsed && (
                    <div style={{ marginTop: "0.5em" }}>
                        {contextItems.map((item, index) => (
                            <div key={index} style={{ marginBottom: "0.25em" }}>
                                <VSCodeLink
                                    href="#"
                                    title={item}
                                    onClick={() => openContextItem(item)}
                                >
                                    {item.length > 50 ? `${item.substring(0, 47)}...` : item}
                                </VSCodeLink>
                            </div>
                        ))}
                        {Object.entries(sourceCellMap).map(([cellId, cellData]) => (
                            <div key={cellId} style={{ marginBottom: "0.5em" }}>
                                <VSCodeLink href="#" onClick={() => openContextItem(cellId)}>
                                    Source Cell: {cellId}
                                </VSCodeLink>
                                {renderSourceCellContent(cellId, cellData.content)}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )
    );
};
