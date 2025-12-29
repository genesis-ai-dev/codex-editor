import React, { useEffect, useRef } from "react";
import type { ValidationEntry } from "../../../../../types";
import { formatTimestamp, audioPopoverTracker } from "../validationUtils";

interface ValidatorPopoverProps {
    anchorRef: React.RefObject<HTMLElement>;
    show: boolean;
    setShow: (show: boolean) => void;
    validators: ValidationEntry[];
    currentUsername: string | null;
    uniqueId: string;
    onRemoveSelf?: () => void;
    onRequestClose?: () => void;
    cancelCloseTimer?: () => void;
    scheduleCloseTimer?: (cb: () => void, delay?: number) => void;
    title?: string;
    popoverTracker?: {
        getActivePopover: () => string | null;
        setActivePopover: (id: string | null) => void;
    };
}

export const ValidatorPopover: React.FC<ValidatorPopoverProps> = ({
    anchorRef,
    show,
    setShow,
    validators,
    currentUsername,
    uniqueId,
    onRemoveSelf,
    onRequestClose,
    cancelCloseTimer,
    scheduleCloseTimer,
    title = "Validators",
    popoverTracker = audioPopoverTracker,
}) => {
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!show || !popoverRef.current || !anchorRef.current) return;

        const positionPopover = () => {
            if (!popoverRef.current || !anchorRef.current) return;

            const buttonRect = anchorRef.current.getBoundingClientRect();
            const popoverRect = popoverRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            // Vertical positioning
            const spaceAbove = buttonRect.top;
            const spaceBelow = viewportHeight - (buttonRect.top + buttonRect.height);
            let top = 0;
            if (spaceBelow >= popoverRect.height + 10) {
                top = buttonRect.height + 5; // place below the badge
            } else if (spaceAbove >= popoverRect.height + 10) {
                top = -popoverRect.height - 5; // place above the badge
            } else {
                top = -(popoverRect.height / 2) + buttonRect.height / 2; // center align
            }

            // Horizontal positioning (dynamic left/right with clamping to viewport)
            const spaceRight = viewportWidth - (buttonRect.left + buttonRect.width);
            const spaceLeft = buttonRect.left;
            let left = 0;
            if (spaceRight >= popoverRect.width + 10) {
                // Enough room on the right → align left edges
                left = 0;
            } else if (spaceLeft >= popoverRect.width + 10) {
                // Open to the left so the popover fits within the card/viewport
                left = -popoverRect.width + buttonRect.width;
            } else {
                // Center relative to the badge
                left = -(popoverRect.width / 2 - buttonRect.width / 2);
                // Clamp to viewport so it never overflows
                const minLeft = 8 - buttonRect.left; // keep 8px from left edge
                const maxLeft = viewportWidth - popoverRect.width - 8 - buttonRect.left; // 8px from right edge
                left = Math.min(Math.max(left, minLeft), maxLeft);
            }

            const style = popoverRef.current.style;
            style.top = `${top}px`;
            style.left = `${left}px`;
            style.right = "auto";
            style.position = "absolute";
            style.opacity = "1";
            style.pointerEvents = "auto";
            style.zIndex = "100000";
        };

        // Initial position
        positionPopover();

        // Reposition on resize/scroll to keep within bounds
        window.addEventListener("resize", positionPopover);
        window.addEventListener("scroll", positionPopover, true);
        return () => {
            window.removeEventListener("resize", positionPopover);
            window.removeEventListener("scroll", positionPopover, true);
        };
    }, [show, anchorRef]);

    // Close when clicking outside of both the anchor and the popover
    useEffect(() => {
        if (!show) return;
        const handleOutsideClick = (event: MouseEvent) => {
            const target = event.target as Node | null;
            const anchorEl = anchorRef.current;
            const popoverEl = popoverRef.current;

            const clickInsideAnchor = Boolean(anchorEl && target && anchorEl.contains(target));
            const clickInsidePopover = Boolean(popoverEl && target && popoverEl.contains(target));

            if (clickInsideAnchor || clickInsidePopover) return;

            setShow(false);
            onRequestClose && onRequestClose();
            if (popoverTracker.getActivePopover() === uniqueId) {
                popoverTracker.setActivePopover(null);
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);
        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [show, anchorRef, setShow, uniqueId, onRequestClose]);

    const handleMouseEnter = (e: React.MouseEvent) => {
        e.stopPropagation();
        cancelCloseTimer && cancelCloseTimer();
    };

    const handleMouseLeave = (e: React.MouseEvent) => {
        e.stopPropagation();
        scheduleCloseTimer &&
            scheduleCloseTimer(() => {
                setShow(false);
                if (popoverTracker.getActivePopover() === uniqueId) {
                    popoverTracker.setActivePopover(null);
                }
            }, 100);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (e.key === "Escape") {
            e.preventDefault();
            setShow(false);
            onRequestClose && onRequestClose();
        }
    };

    if (!show || validators.length === 0) return null;

    return (
        <div
            ref={popoverRef}
            className="audio-validation-popover absolute flex flex-col gap-y-2 rounded-md shadow-md p-2"
            style={{
                zIndex: 100000,
                opacity: show ? "1" : "0",
                transition: "opacity 0.2s ease-in-out",
                pointerEvents: show ? "auto" : "none",
                backgroundColor: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-editorWidget-border)",
                // Ensure the popover fully covers underlying waveform/time text
                mixBlendMode: "normal",
                width: "max-content",
                minWidth: "12rem",
                maxWidth: "min(320px, calc(100vw - 24px))",
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onKeyDown={handleKeyDown}
        >
            <div className="flex items-center justify-between w-full">
                <div className="font-extralight text-base">{title}</div>
                <div
                    tabIndex={0}
                    className="flex items-baseline justify-end cursor-pointer font-light text-gray-400"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShow(false);
                        onRequestClose && onRequestClose();
                        if (popoverTracker.getActivePopover() === uniqueId) {
                            popoverTracker.setActivePopover(null);
                        }
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            setShow(false);
                            onRequestClose && onRequestClose();
                        }
                    }}
                >
                    <i className="codicon codicon-close" />
                </div>
            </div>
            <div className="flex flex-col gap-y-2">
                {validators.map((user) => {
                    const isCurrentUser = user.username === currentUsername;

                    return (
                        <div
                            className="relative flex items-center justify-between"
                            key={user.username}
                        >
                            <div className="flex flex-1 items-center justify-between">
                                <div className="flex flex-col">
                                    <span
                                        className={`${isCurrentUser ? "font-bold" : "font-normal"}`}
                                        style={{ overflowWrap: "anywhere" }}
                                    >
                                        {user.username}
                                    </span>
                                    <span
                                        className="flex text-xs"
                                        style={{
                                            color: "var(--vscode-descriptionForeground)",
                                        }}
                                    >
                                        {formatTimestamp(user.updatedTimestamp)}
                                    </span>
                                </div>

                                {isCurrentUser && onRemoveSelf && (
                                    <span
                                        tabIndex={0}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemoveSelf();
                                            setShow(false);
                                            if (popoverTracker.getActivePopover() === uniqueId) {
                                                popoverTracker.setActivePopover(null);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                onRemoveSelf();
                                                setShow(false);
                                            }
                                        }}
                                        title="Remove your audio validation"
                                        className="audio-validation-trash-icon flex items-start justify-center cursor-pointer h-8"
                                        style={{
                                            transition: "background-color 0.2s",
                                        }}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
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
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ValidatorPopover;
