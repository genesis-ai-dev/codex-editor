import React, { useState } from "react";
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";

type ContextItemListProps = {
    contextItems: string[];
    vscode: any;
};

export const ContextItemList: React.FC<ContextItemListProps> = ({
    contextItems,
    vscode, // Needed to send messages to the extension host
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true);

    const toggleCollapse = () => setIsCollapsed(!isCollapsed);

    const openContextItem = (item: string) => {
        vscode.postMessage({
            command: "openContextItem",
            text: item,
            // FIXME: I'm just going to check the string for 'Notes' or 'Questions' respectively, and open the webview for the appropriate one.
            // This is a serious hack. I should be passing the context item type as well, and that should be passed in from a more sophisticated context object other than a string.
        });
    };

    return (
        (contextItems.length > 0 && (
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
                    <i
                        className="codicon codicon-quote"
                        title="Selected Text Indicator"
                    ></i>
                    {isCollapsed ? "Show Context Items" : "Hide Context Items"}
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
                                    {item.length > 50
                                        ? `${item.substring(0, 47)}...`
                                        : item}
                                </VSCodeLink>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        )) || <div className="No-additional-context-items-found" />
    );
};
