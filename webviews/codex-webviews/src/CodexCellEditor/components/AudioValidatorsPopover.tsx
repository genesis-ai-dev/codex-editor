import React, { useEffect, useRef } from "react";
import type { ValidationEntry } from "../../../../../types";
import { formatTimestamp, audioPopoverTracker } from "../validationUtils";

interface AudioValidatorsPopoverProps {
    anchorRef: React.RefObject<HTMLElement>;
    show: boolean;
    setShow: (show: boolean) => void;
    validators: ValidationEntry[];
    currentUsername: string | null;
    uniqueId: string;
    onRemoveSelf?: () => void;
    persistent?: boolean;
    onRequestClose?: () => void;
}

export const AudioValidatorsPopover: React.FC<AudioValidatorsPopoverProps> = ({
    anchorRef,
    show,
    setShow,
    validators,
    currentUsername,
    uniqueId,
    onRemoveSelf,
    persistent = false,
    onRequestClose,
}) => {
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!show || !popoverRef.current || !anchorRef.current) return;
        const buttonRect = anchorRef.current.getBoundingClientRect();
        const popoverRect = popoverRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const spaceAbove = buttonRect.top;
        const spaceBelow = viewportHeight - (buttonRect.top + buttonRect.height);
        const spaceRight = viewportWidth - (buttonRect.left + buttonRect.width);
        const spaceLeft = buttonRect.left;

        let left = buttonRect.width + 5;
        let top = 0;
        if (spaceRight < popoverRect.width + 10) {
            left = -popoverRect.width - 5;
        }
        if (spaceRight < popoverRect.width + 10 && spaceLeft < popoverRect.width + 10) {
            left = -(popoverRect.width / 2) + buttonRect.width / 2;
        }
        if (spaceBelow >= popoverRect.height + 10) {
            top = buttonRect.height + 5;
        } else if (spaceAbove >= popoverRect.height + 10) {
            top = -popoverRect.height - 5;
        } else {
            top = -(popoverRect.height / 2) + buttonRect.height / 2;
        }

        const finalLeft = Math.min(
            Math.max(left, -buttonRect.left + 10),
            viewportWidth - buttonRect.left - popoverRect.width - 10
        );
        const finalTop = Math.min(
            Math.max(top, -buttonRect.top + 10),
            viewportHeight - buttonRect.top - popoverRect.height - 10
        );

        popoverRef.current.style.position = "fixed";
        popoverRef.current.style.top = `${buttonRect.top + finalTop}px`;
        popoverRef.current.style.left = `${buttonRect.left + finalLeft}px`;
        popoverRef.current.style.opacity = "1";
        popoverRef.current.style.pointerEvents = "auto";
        popoverRef.current.style.zIndex = "100000";
    }, [show, anchorRef]);

    if (!show || validators.length === 0) return null;

    return (
        <div
            ref={popoverRef}
            className="audio-validation-popover"
            style={{
                position: "fixed",
                zIndex: 100000,
                opacity: show ? "1" : "0",
                transition: "opacity 0.2s ease-in-out",
                pointerEvents: show ? "auto" : "none",
                backgroundColor: "var(--vscode-editor-background)",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                border: "1px solid var(--vscode-editorWidget-border)",
            }}
            onMouseEnter={(e) => {
                e.stopPropagation();
                setShow(true);
            }}
            onMouseLeave={(e) => {
                e.stopPropagation();
                if (!persistent) {
                    setShow(false);
                    if (audioPopoverTracker.getActivePopover() === uniqueId) {
                        audioPopoverTracker.setActivePopover(null);
                    }
                }
            }}
        >
            {persistent && (
                <div
                    style={{ position: "absolute", right: "8px", top: "8px", cursor: "pointer" }}
                    onClick={(e) => {
                        e.stopPropagation();
                        setShow(false);
                        onRequestClose && onRequestClose();
                        if (audioPopoverTracker.getActivePopover() === uniqueId) {
                            audioPopoverTracker.setActivePopover(null);
                        }
                    }}
                >
                    <i className="codicon codicon-close" />
                </div>
            )}
            <div style={{ padding: "0 8px" }}>
                <div
                    style={{
                        fontWeight: "bold",
                        marginBottom: "4px",
                        borderBottom: "1px solid var(--vscode-editorWidget-border)",
                        paddingBottom: "4px",
                    }}
                >
                    Audio Validators
                </div>
                {validators.map((user) => {
                    const isCurrentUser = user.username === currentUsername;
                    return (
                        <div
                            key={user.username}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "3px 0",
                                position: "relative",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    flex: "1",
                                }}
                            >
                                <span style={{ fontWeight: isCurrentUser ? "600" : "400" }}>
                                    {user.username}
                                </span>
                                {isCurrentUser && onRemoveSelf && (
                                    <span
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemoveSelf();
                                            setShow(false);
                                            if (
                                                audioPopoverTracker.getActivePopover() === uniqueId
                                            ) {
                                                audioPopoverTracker.setActivePopover(null);
                                            }
                                        }}
                                        title="Remove your audio validation"
                                        className="audio-validation-trash-icon"
                                        style={{
                                            cursor: "pointer",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            padding: "2px",
                                            borderRadius: "3px",
                                            transition: "background-color 0.2s",
                                        }}
                                    >
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            xmlns="http://www.w3.org/2000/svg"
                                        >
                                            <path
                                                d="M3 6H5H21"
                                                stroke="#ff5252"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                            <path
                                                d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z"
                                                stroke="#ff5252"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                            <path
                                                d="M10 11V17"
                                                stroke="#ff5252"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                            <path
                                                d="M14 11V17"
                                                stroke="#ff5252"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    </span>
                                )}
                                <span
                                    style={{
                                        fontSize: "11px",
                                        color: "var(--vscode-descriptionForeground)",
                                        marginLeft: "auto",
                                    }}
                                >
                                    {formatTimestamp(user.updatedTimestamp)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AudioValidatorsPopover;
