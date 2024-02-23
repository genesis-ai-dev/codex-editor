import React, { useState } from "react";
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";

type ContextItemListProps = {
    contextItems: string[];
};

export const ContextItemList: React.FC<ContextItemListProps> = ({
    contextItems,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true);

    const toggleCollapse = () => setIsCollapsed(!isCollapsed);

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
                                <VSCodeLink href="#" title={item}>
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
