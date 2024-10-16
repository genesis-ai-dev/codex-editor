import React, { useState } from "react";
import { ChatMessageWithContext } from "../../../../types";
import { VSCodeTag } from "@vscode/webview-ui-toolkit/react";
import { ChatRoleLabel } from "../common";

interface MessageItemProps {
    messageItem: ChatMessageWithContext;
    showSenderRoleLabels?: boolean;
    onEditComplete?: (updatedMessage: ChatMessageWithContext) => void; // Callback for edit completion.
}

const ALWAYS_SHOW = false;

export const MessageItem: React.FC<MessageItemProps> = ({
    messageItem,
    showSenderRoleLabels = false,
    onEditComplete, // Callback function to notify parent of edit completion
}) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isDropdownVisible, setIsDropdownVisible] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState(messageItem.content); // Edited content state

    const handleMouseEnter = () => setIsHovered(true);
    const handleMouseLeave = () => {
        setIsHovered(false);
        setIsDropdownVisible(false);
    };
    const toggleDropdown = () => setIsDropdownVisible(!isDropdownVisible);

    const handleEditClick = () => {
        setIsEditing(true);
        setIsDropdownVisible(false); // close dropdown
        setEditedContent(messageItem.content); // Reset edited content
    };

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setEditedContent(event.target.value); // Update edited content
    };

    const handleSaveClick = () => {
        // Notify parent component if exists
        if (onEditComplete) {
            onEditComplete({ ...messageItem, content: editedContent }); // Pass edited message back
        }
        setIsEditing(false); // Exit edit mode
    };

    return (
        <div
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
                position: "relative",
                display: messageItem.role === "system" ? "none" : "flex",
                flexDirection: "column",
                gap: "0.5em",
                justifyContent:
                    messageItem.role === "user"
                        ? "flex-start"
                        : messageItem.role === "assistant"
                          ? "flex-end"
                          : "center",
                padding: "0.5em 1em",
                // maxWidth: messageItem.role === "context" ? "100%" : "80%", // full width for 'context' messages
                alignSelf:
                    messageItem.role === "assistant"
                        ? "flex-start"
                        : messageItem.role === "user"
                          ? "flex-end"
                          : "center",
            }}
        >
            {(messageItem.role === "user" || messageItem.role === "assistant") && (
                <div
                    style={{
                        fontSize: "0.7em",
                        color: "lightgrey",
                        marginBottom: "0.2em",
                        marginLeft: messageItem.role === "assistant" ? "9px" : "0px",
                        marginRight: messageItem.role === "user" ? "9px" : "0px",
                        alignSelf: messageItem.role === "assistant" ? "flex-start" : "flex-end",
                    }}
                >
                    {new Date(messageItem.createdAt).toLocaleTimeString()}{" "}
                    {/* FIXME: add actual timestamps */}
                </div>
            )}
            <div
                style={{
                    display: messageItem.role === "system" ? "none" : "flex",
                    flexDirection:
                        messageItem.role === "assistant"
                            ? "row"
                            : messageItem.role === "user"
                              ? "row-reverse"
                              : "column",
                    gap: "0.5em",
                    justifyContent:
                        messageItem.role === "assistant"
                            ? "flex-start"
                            : messageItem.role === "user"
                              ? "flex-end"
                              : "center",
                    borderRadius: "20px",
                    backgroundColor:
                        messageItem.role === "assistant"
                            ? "var(--vscode-editor-background)"
                            : messageItem.role === "user"
                              ? "var(--vscode-button-background)"
                              : "lightblue", // distinct style for 'context' messages
                    color:
                        messageItem.role === "assistant"
                            ? "var(--vscode-editor-foreground)"
                            : messageItem.role === "user"
                              ? "var(--vscode-button-foreground)"
                              : "black", // distinct style for 'context' messages
                    padding: "0.5em 1em",
                    // maxWidth: messageItem.role === "context" ? "100%" : "80%", // full width for 'context' messages
                    alignSelf:
                        messageItem.role === "assistant"
                            ? "flex-start"
                            : messageItem.role === "user"
                              ? "flex-end"
                              : "center",
                }}
            >
                {showSenderRoleLabels && (
                    <VSCodeTag>
                        {ChatRoleLabel[messageItem.role as keyof typeof ChatRoleLabel]}
                    </VSCodeTag>
                )}
                {/* Message Content */}
                {isEditing ? (
                    <div style={{ position: "relative" }}>
                        <input
                            type="text"
                            value={editedContent}
                            onChange={handleChange}
                            onBlur={handleSaveClick} // Optional: save on blur
                            style={{ width: "100%", padding: "0.5em" }}
                        />
                        {/* Check-Mark to Save */}
                        <span
                            onClick={handleSaveClick}
                            style={{
                                position: "absolute",
                                top: "150%",
                                right: "-10px", // Adjust position as needed
                                transform: "translateY(-50%)", // Center vertically
                                cursor: "pointer",
                                fontSize: "1.5em", // Size of the check-mark
                            }}
                            role="img" // This helps with accessibility
                            aria-label="save"
                        >
                            ✔️
                        </span>
                    </div>
                ) : (
                    <div style={{ display: "flex" }}>{messageItem.content}</div>
                )}
            </div>

            {(isHovered || ALWAYS_SHOW) && (
                <div
                    onClick={toggleDropdown}
                    style={{ position: "absolute", top: "30px", right: "20px" }}
                >
                    {/* Replace with your dropdown icon */}
                    <span>▼</span> {/* Placeholder icon */}
                </div>
            )}

            {/* Dropdown Menu */}
            {isDropdownVisible && (
                <div
                    style={{
                        position: "absolute",
                        top: "50px", // Adjust based on your layout
                        right: "20px",
                        backgroundColor: "white", // Customize styles
                        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.1)",
                        zIndex: 1000,
                    }}
                >
                    <div onClick={handleEditClick} style={{ padding: "8px", cursor: "pointer" }}>
                        Edit
                    </div>
                </div>
            )}
        </div>
    );
};
