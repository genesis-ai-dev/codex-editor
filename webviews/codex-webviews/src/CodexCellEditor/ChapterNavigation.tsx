import React, { useState, useEffect, CSSProperties, useRef } from "react";
import ReactDOM from "react-dom";
import {
    VSCodeBadge,
    VSCodeButton,
    VSCodeRadio,
    VSCodeRadioGroup,
    VSCodeTag,
    VSCodeCheckbox,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import NotebookMetadataModal from "./NotebookMetadataModal";
import { CustomNotebookMetadata, QuillCellContent } from "../../../../types";

interface AutocompleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (
        numberOfCells: number,
        includeNotValidatedByAnyUser: boolean,
        includeNotValidatedByCurrentUser: boolean
    ) => void;
    totalUntranslatedCells: number;
    totalCellsToAutocomplete: number;
    totalCellsWithCurrentUserOption: number;
    defaultValue?: number;
}

// Helper component to display validation icons
const ValidationIconSet: React.FC<{
    showEmptyCells?: boolean;
    showNoValidatorCells?: boolean;
    showNotCurrentUserCells?: boolean;
    style?: CSSProperties;
}> = ({
    showEmptyCells = true,
    showNoValidatorCells = false,
    showNotCurrentUserCells = false,
    style = {},
}) => {
    const commonIconStyle: CSSProperties = {
        fontSize: "12px",
        transition: "color 0.2s ease-in-out, opacity 0.2s ease-in-out",
    };

    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                marginLeft: "8px",
                padding: "4px 8px",
                backgroundColor: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-widget-border)",
                borderRadius: "4px",
                boxShadow: "0 0 2px var(--vscode-widget-shadow)",
                transition: "background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
                ...style,
            }}
        >
            <span
                style={{
                    ...commonIconStyle,
                    color: showEmptyCells
                        ? "var(--vscode-descriptionForeground)"
                        : "var(--vscode-disabledForeground)",
                    fontWeight: "bold",
                    width: "16px",
                    height: "16px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: showEmptyCells ? 1 : 0.5,
                }}
            >
                —
            </span>
            <i
                className="codicon codicon-circle-outline"
                style={{
                    ...commonIconStyle,
                    color: showNoValidatorCells
                        ? "var(--vscode-descriptionForeground)"
                        : "var(--vscode-disabledForeground)",
                    opacity: showNoValidatorCells ? 1 : 0.5,
                }}
            ></i>
            <i
                className="codicon codicon-circle-filled"
                style={{
                    ...commonIconStyle,
                    color: showNotCurrentUserCells
                        ? "var(--vscode-descriptionForeground)"
                        : "var(--vscode-disabledForeground)",
                    opacity: showNotCurrentUserCells ? 1 : 0.5,
                }}
            ></i>
        </div>
    );
};

// Helper component for showing validation icon legend tooltips
const ValidationLegend: React.FC<{
    position?: "top" | "bottom" | "left" | "right";
    style?: CSSProperties;
    showToSide?: boolean;
    parentRef?: React.RefObject<HTMLDivElement>;
}> = ({ position = "bottom", style = {}, showToSide = false, parentRef }) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Adjust position if needed to prevent cutoff
    useEffect(() => {
        if (showTooltip && tooltipRef.current && containerRef.current) {
            const tooltipRect = tooltipRef.current.getBoundingClientRect();
            const containerRect = containerRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            if (showToSide) {
                // Position to the right of the icon
                tooltipRef.current.style.left = `${containerRect.width + 5}px`;
                tooltipRef.current.style.top = `${-10}px`;
                tooltipRef.current.style.transform = "none";

                // Check if tooltip would go off right of screen
                if (containerRect.right + tooltipRect.width + 10 > viewportWidth) {
                    // Switch to left side of icon
                    tooltipRef.current.style.left = "auto";
                    tooltipRef.current.style.right = `${containerRect.width + 5}px`;
                }
            } else {
                // Center the tooltip under the icon
                const iconCenterX = containerRect.left + containerRect.width / 2;
                const tooltipWidth = tooltipRect.width;

                // Calculate left position to center the tooltip under the icon
                let leftPos = iconCenterX - tooltipWidth / 2;

                // Prevent tooltip from going off-screen to the left
                if (leftPos < 10) {
                    leftPos = 10;
                }

                // Prevent tooltip from going off-screen to the right
                if (leftPos + tooltipWidth > viewportWidth - 10) {
                    leftPos = viewportWidth - tooltipWidth - 10;
                }

                // Apply the horizontal position
                tooltipRef.current.style.left = `${leftPos}px`;
                tooltipRef.current.style.right = "auto";

                // Check if tooltip would go off bottom of screen
                if (tooltipRect.bottom > viewportHeight - 10) {
                    tooltipRef.current.style.top = "auto";
                    tooltipRef.current.style.bottom = `${containerRect.height + 5}px`;
                } else {
                    tooltipRef.current.style.top = `${containerRect.height + 5}px`;
                    tooltipRef.current.style.bottom = "auto";
                }
            }
        }
    }, [showTooltip, showToSide]);

    return (
        <div
            ref={containerRef}
            style={{
                display: "inline-flex",
                position: "relative",
                marginLeft: "6px",
                ...style,
            }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            <i
                className="codicon codicon-info"
                style={{
                    color: "var(--vscode-descriptionForeground)",
                    fontSize: "14px",
                    cursor: "help",
                }}
            />
            {showTooltip && (
                <div
                    ref={tooltipRef}
                    style={{
                        position: parentRef ? "fixed" : "absolute",
                        top: showToSide ? "-10px" : "100%",
                        left: showToSide ? "100%" : "50%",
                        transform: parentRef || showToSide ? "none" : "translateX(-50%)",
                        backgroundColor: "var(--vscode-editor-background)",
                        border: "1px solid var(--vscode-widget-border)",
                        borderRadius: "4px",
                        padding: "8px",
                        zIndex: 1000,
                        width: "auto",
                        maxWidth: "300px",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                        fontWeight: "normal",
                        fontSize: "12px",
                        color: "var(--vscode-foreground)",
                        marginTop: showToSide ? "0" : parentRef ? "0" : "4px",
                        lineHeight: "1.5",
                        whiteSpace: "nowrap",
                    }}
                >
                    <div style={{ fontWeight: "bold", marginBottom: "6px" }}>
                        Validation Status Icons:
                    </div>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
                        <i
                            className="codicon codicon-dash"
                            style={{
                                fontWeight: "bold",
                                width: "16px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginRight: "6px",
                            }}
                        ></i>
                        <span>Empty/Untranslated</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
                        <i
                            className="codicon codicon-circle-outline"
                            style={{ fontSize: "12px", marginRight: "6px" }}
                        ></i>
                        <span>Without any validator</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
                        <i
                            className="codicon codicon-circle-filled"
                            style={{ fontSize: "12px", marginRight: "6px" }}
                        ></i>
                        <span>Validated by others</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
                        <div
                            style={{
                                display: "flex",
                                marginRight: "6px",
                                width: "16px",
                                justifyContent: "center",
                            }}
                        >
                            <i
                                className="codicon codicon-check"
                                style={{
                                    fontSize: "12px",
                                    color: "var(--vscode-terminal-ansiGreen)",
                                }}
                            ></i>
                        </div>
                        <span>Validated by you</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
                        <div
                            style={{
                                display: "flex",
                                marginRight: "6px",
                                width: "16px",
                                justifyContent: "center",
                            }}
                        >
                            <i
                                className="codicon codicon-check-all"
                                style={{
                                    fontSize: "12px",
                                    color: "var(--vscode-descriptionForeground)",
                                }}
                            ></i>
                        </div>
                        <span>Fully validated by other users</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center" }}>
                        <div
                            style={{
                                display: "flex",
                                marginRight: "6px",
                                width: "16px",
                                justifyContent: "center",
                            }}
                        >
                            <i
                                className="codicon codicon-check-all"
                                style={{
                                    fontSize: "12px",
                                    color: "var(--vscode-terminal-ansiGreen)",
                                }}
                            ></i>
                        </div>
                        <span>Fully validated by you</span>
                    </div>
                </div>
            )}
        </div>
    );
};

const AutocompleteModal: React.FC<AutocompleteModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    totalUntranslatedCells,
    totalCellsToAutocomplete,
    totalCellsWithCurrentUserOption,
    defaultValue = Math.min(5, totalUntranslatedCells > 0 ? totalUntranslatedCells : 5),
}) => {
    // Initialize with the correct value for non-user-validated cells
    const [numberOfCellsToAutocomplete, setNumberOfCellsToAutocomplete] = useState(
        totalUntranslatedCells > 0 ? defaultValue : 0
    );
    const [customValue, setCustomValue] = useState(totalUntranslatedCells > 0 ? defaultValue : 0);
    // Both checkboxes start unchecked, so we only select empty cells by default
    const [includeNotValidatedByAnyUser, setIncludeNotValidatedByAnyUser] = useState(false);
    const [includeNotValidatedByCurrentUser, setIncludeNotValidatedByCurrentUser] = useState(false);
    // Start with the base total - only cells with no content
    const [effectiveTotalCells, setEffectiveTotalCells] = useState(totalUntranslatedCells);

    // Create a reference to the modal container
    const [modalContainer, setModalContainer] = useState<HTMLElement | null>(null);
    const modalRef = React.useRef<HTMLDivElement>(null);

    // Initialize the modal container on component mount
    useEffect(() => {
        if (typeof document !== "undefined") {
            setModalContainer(document.body);
        }
    }, []);

    // Focus trap and ESC key handling
    useEffect(() => {
        if (isOpen && modalRef.current) {
            // Auto-focus the modal when opened
            modalRef.current.focus();

            // Handle ESC key press
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === "Escape") {
                    onClose();
                }
            };

            document.addEventListener("keydown", handleKeyDown);
            return () => {
                document.removeEventListener("keydown", handleKeyDown);
            };
        }
    }, [isOpen, onClose]);

    // Log initial values to debug
    useEffect(() => {
        console.log("Modal initialized with:", {
            totalUntranslatedCells,
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption,
            defaultValue,
            effectiveTotalCells,
        });
    }, []);

    // Update effective total cells when props or checkbox states change
    useEffect(() => {
        console.log("Props or checkbox state changed:", {
            totalUntranslatedCells,
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption,
            includeNotValidatedByAnyUser,
            includeNotValidatedByCurrentUser,
        });

        // Calculate the effective total based on checkboxes
        let newEffectiveTotal = 0;

        if (includeNotValidatedByCurrentUser) {
            // Include all cells not validated by current user
            newEffectiveTotal = totalCellsWithCurrentUserOption;
        } else if (includeNotValidatedByAnyUser) {
            // Include cells not validated by any user
            newEffectiveTotal = totalCellsToAutocomplete;
        } else {
            // Only include cells with no content
            newEffectiveTotal = totalUntranslatedCells;
        }

        setEffectiveTotalCells(newEffectiveTotal);

        // If number of cells is less than 5, automatically set to min(5, effectiveTotalCells)
        if (numberOfCellsToAutocomplete < 5 && newEffectiveTotal > numberOfCellsToAutocomplete) {
            const newValue = Math.min(5, newEffectiveTotal);
            setNumberOfCellsToAutocomplete(newValue);
            setCustomValue(newValue);
        }
        // If number of cells exceeds the new total, cap it
        else if (numberOfCellsToAutocomplete > newEffectiveTotal) {
            const newValue = Math.min(5, newEffectiveTotal > 0 ? newEffectiveTotal : 0);
            setNumberOfCellsToAutocomplete(newValue);
            setCustomValue(newValue);
        }
    }, [
        totalUntranslatedCells,
        totalCellsToAutocomplete,
        totalCellsWithCurrentUserOption,
        includeNotValidatedByAnyUser,
        includeNotValidatedByCurrentUser,
    ]);

    // Handler for "Include cells not validated by any user" checkbox
    const handleAnyUserCheckboxChange = (newValue: boolean) => {
        console.log("ANY USER CHECKBOX CHANGED TO:", newValue);

        // Calculate what the new effective total will be
        let newEffectiveTotal;
        if (newValue) {
            if (includeNotValidatedByCurrentUser) {
                // If "current user" is already checked, value won't change
                newEffectiveTotal = totalCellsWithCurrentUserOption;
            } else {
                // Moving from empty cells to cells not validated by any user
                newEffectiveTotal = totalCellsToAutocomplete;
            }
        } else {
            if (includeNotValidatedByCurrentUser) {
                // If "current user" is still checked, value won't change
                newEffectiveTotal = totalCellsWithCurrentUserOption;
            } else {
                // Moving back to only empty cells
                newEffectiveTotal = totalUntranslatedCells;
            }
        }

        // Only update to 5 if current value is 0, otherwise preserve the custom value
        if (customValue === 0 && newEffectiveTotal > 0) {
            const newDefaultValue = Math.min(5, newEffectiveTotal);
            setNumberOfCellsToAutocomplete(newDefaultValue);
            setCustomValue(newDefaultValue);
        }
        // If current value exceeds new maximum, cap it
        else if (customValue > newEffectiveTotal) {
            const cappedValue = newEffectiveTotal;
            setNumberOfCellsToAutocomplete(cappedValue);
            setCustomValue(cappedValue);
        }

        setIncludeNotValidatedByAnyUser(newValue);
    };

    // Handler for "Include cells not validated by current user" checkbox
    const handleCurrentUserCheckboxChange = (newValue: boolean) => {
        console.log("CURRENT USER CHECKBOX CHANGED TO:", newValue);

        // Calculate what the new effective total will be
        let newEffectiveTotal;
        if (newValue) {
            // Moving to cells not validated by current user (most inclusive)
            newEffectiveTotal = totalCellsWithCurrentUserOption;
        } else {
            if (includeNotValidatedByAnyUser) {
                // Moving back to cells not validated by any user
                newEffectiveTotal = totalCellsToAutocomplete;
            } else {
                // Moving back to only empty cells
                newEffectiveTotal = totalUntranslatedCells;
            }
        }

        // Only update to 5 if current value is 0, otherwise preserve the custom value
        if (customValue === 0 && newEffectiveTotal > 0) {
            const newDefaultValue = Math.min(5, newEffectiveTotal);
            setNumberOfCellsToAutocomplete(newDefaultValue);
            setCustomValue(newDefaultValue);
        }
        // If current value exceeds new maximum, cap it
        else if (customValue > newEffectiveTotal) {
            const cappedValue = newEffectiveTotal;
            setNumberOfCellsToAutocomplete(cappedValue);
            setCustomValue(cappedValue);
        }

        setIncludeNotValidatedByCurrentUser(newValue);
    };

    // Render a custom checkbox component
    const CustomCheckbox: React.FC<{
        checked: boolean;
        onChange: (checked: boolean) => void;
        label: React.ReactNode;
    }> = ({ checked, onChange, label }) => (
        <label
            className="checkbox-container"
            style={{
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                marginBottom: "8px",
            }}
        >
            <div
                className="custom-checkbox"
                style={{
                    width: "18px",
                    height: "18px",
                    border: "2px solid var(--vscode-checkbox-border, #6c757d)",
                    borderRadius: "3px",
                    backgroundColor: checked
                        ? "var(--vscode-focusBorder, #007fd4)"
                        : "var(--vscode-checkbox-background, #252526)",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    marginRight: "8px",
                    position: "relative",
                    cursor: "pointer",
                    boxShadow: checked ? "0 0 2px 1px var(--vscode-focusBorder, #007fd4)" : "none",
                }}
                onClick={() => onChange(!checked)}
            >
                {checked && (
                    <div
                        style={{
                            width: "6px",
                            height: "10px",
                            borderRight: "2px solid white",
                            borderBottom: "2px solid white",
                            transform: "rotate(45deg) translate(-1px, -1px)",
                            position: "absolute",
                        }}
                    />
                )}
            </div>
            <span onClick={() => onChange(!checked)}>{label}</span>
        </label>
    );

    // Determine which icons to show based on checkbox states
    const getIconsToShow = () => {
        if (includeNotValidatedByCurrentUser) {
            return {
                showEmptyCells: true,
                showNoValidatorCells: true,
                showNotCurrentUserCells: true,
            };
        } else if (includeNotValidatedByAnyUser) {
            return {
                showEmptyCells: true,
                showNoValidatorCells: true,
                showNotCurrentUserCells: false,
            };
        } else {
            return {
                showEmptyCells: true,
                showNoValidatorCells: false,
                showNotCurrentUserCells: false,
            };
        }
    };

    const { showEmptyCells, showNoValidatorCells, showNotCurrentUserCells } = getIconsToShow();

    if (!isOpen || !modalContainer) return null;

    // Use a portal to render the modal at the document body level
    return ReactDOM.createPortal(
        <div
            className="modal-overlay"
            onClick={(e) => {
                // Close when clicking the overlay (outside the modal)
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div className="modal-content" ref={modalRef} tabIndex={-1}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
                    <h2 style={{ margin: 0 }}>Autocomplete Cells</h2>
                    <ValidationLegend position="right" showToSide={true} />
                </div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
                    <VSCodeTag>Autocomplete {numberOfCellsToAutocomplete || 0} Cells</VSCodeTag>
                    <ValidationIconSet
                        showEmptyCells={showEmptyCells}
                        showNoValidatorCells={showNoValidatorCells}
                        showNotCurrentUserCells={showNotCurrentUserCells}
                    />
                </div>
                <VSCodeRadioGroup
                    value={
                        numberOfCellsToAutocomplete === effectiveTotalCells
                            ? effectiveTotalCells.toString()
                            : "custom"
                    }
                    onChange={(e) => {
                        const target = e.target as HTMLInputElement;
                        if (target.value === "custom") {
                            if (effectiveTotalCells === 0) {
                                setCustomValue(0);
                                setNumberOfCellsToAutocomplete(0);
                            } else if (!customValue) {
                                const defaultValue = Math.min(5, effectiveTotalCells);
                                setCustomValue(defaultValue);
                                setNumberOfCellsToAutocomplete(defaultValue);
                            } else {
                                // Use the existing custom value rather than resetting to default
                                setNumberOfCellsToAutocomplete(customValue);
                            }
                        } else if (target.value === effectiveTotalCells.toString()) {
                            setNumberOfCellsToAutocomplete(effectiveTotalCells);
                            // Don't update customValue here to preserve it for when user switches back
                        }
                    }}
                >
                    <label slot="label">Autocomplete</label>
                    <VSCodeRadio value="custom">
                        <input
                            type="number"
                            min="1"
                            max={effectiveTotalCells}
                            defaultValue={Math.min(5, effectiveTotalCells)}
                            value={
                                customValue === 0 ? "0" : Math.min(customValue, effectiveTotalCells)
                            }
                            onFocus={(e) => {
                                const defaultValue = Math.min(5, effectiveTotalCells);
                                if (!customValue) {
                                    setCustomValue(defaultValue);
                                }
                                setNumberOfCellsToAutocomplete(customValue || defaultValue);

                                // Select the custom radio button
                                const radioGroup = e.currentTarget.closest("vscode-radio-group");
                                if (radioGroup) {
                                    const event = new Event("change", {
                                        bubbles: true,
                                    });
                                    Object.defineProperty(event, "target", {
                                        value: { value: "custom" },
                                        enumerable: true,
                                    });
                                    radioGroup.dispatchEvent(event);
                                }
                            }}
                            onChange={(e) => {
                                const inputValue = e.target.value;
                                if (inputValue === "") {
                                    // Allow empty input without converting to 0
                                    setCustomValue(NaN);
                                    setNumberOfCellsToAutocomplete(0);
                                    return;
                                }
                                const value = parseInt(inputValue);
                                if (!isNaN(value) && value >= 0) {
                                    const cappedValue = Math.min(value, effectiveTotalCells);
                                    setCustomValue(cappedValue);
                                    setNumberOfCellsToAutocomplete(cappedValue);
                                }
                            }}
                            style={{
                                width: "60px",
                                marginLeft: "8px",
                                border: "2px solid var(--vscode-focusBorder)",
                                borderRadius: "4px",
                                padding: "4px",
                                outline: "none",
                                boxShadow: "0 0 0 1px var(--vscode-focusBorder)",
                                backgroundColor: "var(--vscode-input-background)",
                                color: "var(--vscode-input-foreground)",
                            }}
                            className="autocomplete-number-input"
                        />
                    </VSCodeRadio>
                    <VSCodeRadio value={effectiveTotalCells.toString()}>
                        All ({effectiveTotalCells})
                    </VSCodeRadio>
                </VSCodeRadioGroup>

                <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
                    <CustomCheckbox
                        checked={includeNotValidatedByAnyUser}
                        onChange={handleAnyUserCheckboxChange}
                        label={
                            <div style={{ display: "flex", alignItems: "center" }}>
                                Include cells not validated by any user
                                <ValidationIconSet
                                    showEmptyCells={true}
                                    showNoValidatorCells={true}
                                    showNotCurrentUserCells={false}
                                    style={{ marginLeft: "4px" }}
                                />
                            </div>
                        }
                    />

                    <CustomCheckbox
                        checked={includeNotValidatedByCurrentUser}
                        onChange={handleCurrentUserCheckboxChange}
                        label={
                            <div style={{ display: "flex", alignItems: "center" }}>
                                Include cells not validated by the current user
                                <ValidationIconSet
                                    showEmptyCells={true}
                                    showNoValidatorCells={true}
                                    showNotCurrentUserCells={true}
                                    style={{ marginLeft: "4px" }}
                                />
                            </div>
                        }
                    />
                </div>

                <div className="modal-actions">
                    <VSCodeButton onClick={onClose} appearance="secondary">
                        Cancel
                    </VSCodeButton>
                    <VSCodeButton
                        onClick={() =>
                            onConfirm(
                                numberOfCellsToAutocomplete,
                                includeNotValidatedByAnyUser,
                                includeNotValidatedByCurrentUser
                            )
                        }
                        disabled={numberOfCellsToAutocomplete === 0}
                    >
                        Confirm
                    </VSCodeButton>
                </div>
            </div>
        </div>,
        modalContainer
    );
};

interface ChapterNavigationProps {
    chapterNumber: number;
    setChapterNumber: React.Dispatch<React.SetStateAction<number>>;
    unsavedChanges: boolean;
    onAutocompleteChapter: (
        numberOfCells: number,
        includeNotValidatedByAnyUser: boolean,
        includeNotValidatedByCurrentUser: boolean
    ) => void;
    onStopAutocomplete: () => void;
    isAutocompletingChapter: boolean;
    onSetTextDirection: (direction: "ltr" | "rtl") => void;
    textDirection: "ltr" | "rtl";
    onSetCellDisplayMode: (mode: CELL_DISPLAY_MODES) => void;
    cellDisplayMode: CELL_DISPLAY_MODES;
    isSourceText: boolean;
    totalChapters: number;
    totalUntranslatedCells: number;
    totalCellsToAutocomplete: number;
    totalCellsWithCurrentUserOption: number;
    openSourceText: (chapterNumber: number) => void;
    shouldShowVideoPlayer: boolean;
    setShouldShowVideoPlayer: React.Dispatch<React.SetStateAction<boolean>>;
    documentHasVideoAvailable: boolean;
    metadata: CustomNotebookMetadata | undefined;
    onMetadataChange: (key: string, value: string) => void;
    onSaveMetadata: () => void;
    onPickFile: () => void;
    onUpdateVideoUrl: (url: string) => void;
    tempVideoUrl: string;
    toggleScrollSync: () => void;
    scrollSyncEnabled: boolean;
    translationUnitsForSection: QuillCellContent[];
    isTranslatingCell?: boolean;
    onStopSingleCellTranslation?: () => void;
    currentSectionId?: number;
    setCurrentSectionId?: React.Dispatch<React.SetStateAction<number>>;
    totalSections?: number;
    vscode: any;
}

const ChapterNavigation: React.FC<ChapterNavigationProps> = ({
    chapterNumber,
    setChapterNumber,
    unsavedChanges,
    onAutocompleteChapter,
    onStopAutocomplete,
    isAutocompletingChapter,
    onSetTextDirection,
    textDirection,
    onSetCellDisplayMode,
    cellDisplayMode,
    isSourceText,
    totalChapters,
    totalUntranslatedCells,
    totalCellsToAutocomplete,
    totalCellsWithCurrentUserOption,
    openSourceText,
    shouldShowVideoPlayer,
    setShouldShowVideoPlayer,
    documentHasVideoAvailable,
    metadata,
    onMetadataChange,
    onSaveMetadata,
    onPickFile,
    onUpdateVideoUrl,
    tempVideoUrl,
    toggleScrollSync,
    scrollSyncEnabled,
    translationUnitsForSection,
    isTranslatingCell = false,
    onStopSingleCellTranslation,
    currentSectionId = 1,
    setCurrentSectionId = () => {},
    totalSections = 1,
    vscode,
}) => {
    const [showConfirm, setShowConfirm] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);
    const [editorPosition, setEditorPosition] = useState<
        "leftmost" | "rightmost" | "center" | "single" | "unknown"
    >("unknown");

    // Request editor position when component mounts
    useEffect(() => {
        if (vscode) {
            vscode.postMessage({ command: "getEditorPosition" });

            // Listen for editor position updates
            const messageHandler = (event: MessageEvent) => {
                const message = event.data;
                if (message.type === "editorPosition") {
                    setEditorPosition(message.position);
                }
            };

            window.addEventListener("message", messageHandler);

            return () => {
                window.removeEventListener("message", messageHandler);
            };
        }
    }, [vscode]);

    const handleAutocompleteClick = () => {
        console.log("Autocomplete clicked, showing modal with:", {
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption,
        });
        setShowConfirm(true);
    };

    const handleConfirmAutocomplete = (
        numberOfCells: number,
        includeNotValidatedByAnyUser: boolean,
        includeNotValidatedByCurrentUser: boolean
    ) => {
        console.log("Confirm autocomplete:", {
            numberOfCells,
            includeNotValidatedByAnyUser,
            includeNotValidatedByCurrentUser,
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption,
        });
        onAutocompleteChapter(
            numberOfCells,
            includeNotValidatedByAnyUser,
            includeNotValidatedByCurrentUser
        );
        setShowConfirm(false);
    };

    const handleCancelAutocomplete = () => {
        setShowConfirm(false);
    };

    const handleToggleVideoPlayer = () => {
        setShouldShowVideoPlayer(!shouldShowVideoPlayer);
    };

    const handleOpenMetadataModal = () => {
        setIsMetadataModalOpen(true);
    };

    const handleCloseMetadataModal = () => {
        setIsMetadataModalOpen(false);
    };

    const handleSaveMetadata = () => {
        onSaveMetadata();
        setIsMetadataModalOpen(false);
        if (metadata?.videoUrl) {
            onUpdateVideoUrl(metadata.videoUrl);
        }
    };

    // Helper to determine if any translation is in progress (either autocomplete or single cell)
    const isAnyTranslationInProgress = isAutocompletingChapter || isTranslatingCell;

    // Common handler for stopping any kind of translation
    const handleStopTranslation = () => {
        if (isAutocompletingChapter) {
            onStopAutocomplete();
        } else if (isTranslatingCell && onStopSingleCellTranslation) {
            onStopSingleCellTranslation();
        }
    };

    const buttonGap = "0.5rem";

    // Generate section options for dropdown
    const sectionOptions = React.useMemo(() => {
        return Array.from({ length: totalSections }, (_, i) => i + 1);
    }, [totalSections]);

    // Handle section change
    const handleSectionChange = (e: any) => {
        const target = e.target as HTMLSelectElement;
        const newSection = parseInt(target.value);
        if (newSection && newSection !== currentSectionId) {
            setCurrentSectionId(newSection);
        }
    };

    // Update this function to use the passed vscode prop
    const handleToggleWorkspaceUI = () => {
        if (vscode) {
            vscode.postMessage({ command: "toggleWorkspaceUI" });
        }
    };

    const handleTogglePrimarySidebar = () => {
        if (vscode) {
            vscode.postMessage({ command: "togglePrimarySidebar" });
        }
    };

    const handleToggleSecondarySidebar = () => {
        if (vscode) {
            vscode.postMessage({ command: "toggleSecondarySidebar" });
        }
    };

    return (
        <div className="chapter-navigation" style={{ gap: buttonGap }}>
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    flexFlow: "nowrap",
                    flex: 1,
                    justifyContent: "flex-start",
                }}
            >
                {isSourceText ? (
                    <>
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => {
                                toggleScrollSync();
                            }}
                        >
                            <i
                                className={`codicon ${
                                    scrollSyncEnabled ? "codicon-lock" : "codicon-unlock"
                                }`}
                            />
                        </VSCodeButton>
                        Source Text
                    </>
                ) : (
                    <VSCodeButton appearance="icon" onClick={() => openSourceText(chapterNumber)}>
                        <i className="codicon codicon-open-preview"></i>
                    </VSCodeButton>
                )}
            </div>

            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "nowrap",
                    alignItems: "center",
                    flex: 1,
                    justifyContent: "center",
                    flexGrow: 2,
                }}
            >
                <div
                    className="chapter-title-container"
                    style={{
                        display: "flex",
                        alignItems: "center",
                        cursor: unsavedChanges ? "not-allowed" : "pointer",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "4px",
                        transition: "background-color 0.2s ease, box-shadow 0.2s ease",
                        position: "relative",
                        backgroundColor: "var(--vscode-button-secondaryBackground, transparent)",
                        border: "1px solid transparent",
                        minWidth: "150px",
                        justifyContent: "center",
                    }}
                    onClick={() => {
                        if (!unsavedChanges) {
                            // Directly use the HTMLSelectElement click to open native dropdown
                            const dropdown = document.getElementById(
                                "chapter-dropdown"
                            ) as HTMLSelectElement;
                            if (dropdown) {
                                // Create and dispatch a mouse event to trigger the dropdown
                                const event = new MouseEvent("mousedown", {
                                    view: window,
                                    bubbles: true,
                                    cancelable: true,
                                });
                                dropdown.dispatchEvent(event);
                            }
                        }
                    }}
                    onMouseEnter={(e) => {
                        if (!unsavedChanges) {
                            e.currentTarget.style.backgroundColor =
                                "var(--vscode-button-secondaryHoverBackground, rgba(90, 93, 94, 0.31))";
                            e.currentTarget.style.boxShadow =
                                "0 0 0 1px var(--vscode-focusBorder, rgba(0, 122, 204, 0.4))";
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor =
                            "var(--vscode-button-secondaryBackground, transparent)";
                        e.currentTarget.style.boxShadow = "none";
                    }}
                    title={
                        unsavedChanges
                            ? "Save changes first to change chapter"
                            : "Click to change chapter"
                    }
                >
                    <h1
                        style={{
                            fontSize: "1.5rem",
                            margin: 0,
                            display: "flex",
                            alignItems: "center",
                            opacity: unsavedChanges ? 0.6 : 1,
                        }}
                    >
                        {(translationUnitsForSection[0]?.cellMarkers?.[0]
                            ?.split(":")[0]
                            .split(" ")[0] || "") +
                            "\u00A0" +
                            (translationUnitsForSection[0]?.cellMarkers?.[0]
                                ?.split(":")[0]
                                .split(" ")[1] || "")}
                        <i
                            className="codicon codicon-chevron-down"
                            style={{
                                fontSize: "0.85rem",
                                marginLeft: "0.5rem",
                                opacity: 0.7,
                            }}
                        />
                    </h1>
                    <select
                        id="chapter-dropdown"
                        style={{
                            position: "absolute",
                            opacity: 0,
                            pointerEvents: unsavedChanges ? "none" : "auto",
                            height: "100%",
                            width: "100%",
                            left: 0,
                            top: 0,
                            cursor: "pointer",
                        }}
                        onChange={(e) => {
                            const newChapter = parseInt(e.target.value);
                            if (newChapter && newChapter !== chapterNumber && !unsavedChanges) {
                                // Send a message to synchronize source/codex views
                                (window as any).vscodeApi.postMessage({
                                    command: "jumpToChapter",
                                    chapterNumber: newChapter,
                                });
                                setChapterNumber(newChapter);
                            }
                        }}
                        value={chapterNumber.toString()}
                        disabled={unsavedChanges}
                    >
                        {Array.from({ length: totalChapters }, (_, i) => i + 1).map((chapter) => (
                            <option key={chapter} value={chapter.toString()}>
                                {chapter} of {totalChapters}
                            </option>
                        ))}
                    </select>
                </div>

                {totalSections > 1 && (
                    <div style={{ display: "flex", alignItems: "center", marginLeft: "1rem" }}>
                        <span style={{ marginRight: "0.5rem" }}>Section:</span>
                        <VSCodeDropdown
                            onChange={handleSectionChange}
                            value={currentSectionId.toString()}
                        >
                            {sectionOptions.map((section) => (
                                <VSCodeOption key={section} value={section.toString()}>
                                    {section} of {totalSections}
                                </VSCodeOption>
                            ))}
                        </VSCodeDropdown>
                    </div>
                )}
            </div>

            <div className="chapter-navigation-group" style={{ gap: buttonGap }}>
                <VSCodeButton
                    appearance="icon"
                    onClick={handleToggleWorkspaceUI}
                    title="Toggle Distraction-Free Mode"
                >
                    <i className="codicon codicon-layout"></i>
                </VSCodeButton>

                {/* Show left sidebar toggle only when editor is not leftmost */}
                {(editorPosition === "rightmost" ||
                    editorPosition === "center" ||
                    editorPosition === "single") && (
                    <VSCodeButton
                        appearance="icon"
                        onClick={handleTogglePrimarySidebar}
                        title="Toggle Primary Sidebar"
                    >
                        <i className="codicon codicon-layout-sidebar-left"></i>
                    </VSCodeButton>
                )}

                {/* Show right sidebar toggle only when editor is not rightmost */}
                {(editorPosition === "leftmost" ||
                    editorPosition === "center" ||
                    editorPosition === "single") && (
                    <VSCodeButton
                        appearance="icon"
                        onClick={handleToggleSecondarySidebar}
                        title="Toggle Secondary Sidebar"
                    >
                        <i className="codicon codicon-layout-sidebar-right"></i>
                    </VSCodeButton>
                )}

                {!isSourceText && (
                    <>
                        {isAnyTranslationInProgress ? (
                            <VSCodeButton
                                appearance="icon"
                                onClick={handleStopTranslation}
                                title={
                                    isAutocompletingChapter
                                        ? "Stop Autocomplete"
                                        : "Stop Translation"
                                }
                                style={{
                                    backgroundColor:
                                        "var(--vscode-editor-findMatchHighlightBackground)",
                                    borderRadius: "4px",
                                }}
                            >
                                <i className="codicon codicon-circle-slash"></i>
                            </VSCodeButton>
                        ) : (
                            <VSCodeButton
                                appearance="icon"
                                onClick={handleAutocompleteClick}
                                disabled={unsavedChanges}
                                title="Autocomplete Chapter"
                            >
                                <i className="codicon codicon-sparkle"></i>
                            </VSCodeButton>
                        )}
                        <AutocompleteModal
                            isOpen={showConfirm}
                            onClose={handleCancelAutocomplete}
                            onConfirm={handleConfirmAutocomplete}
                            totalUntranslatedCells={totalUntranslatedCells}
                            totalCellsToAutocomplete={totalCellsToAutocomplete}
                            totalCellsWithCurrentUserOption={totalCellsWithCurrentUserOption}
                            defaultValue={Math.min(
                                5,
                                totalUntranslatedCells > 0 ? totalUntranslatedCells : 5
                            )}
                        />
                    </>
                )}

                {showAdvancedSettings && (
                    <div className="advanced-settings-container">
                        <VSCodeButton
                            appearance="icon"
                            onClick={() =>
                                onSetTextDirection(textDirection === "ltr" ? "rtl" : "ltr")
                            }
                            disabled={unsavedChanges}
                            title="Set Text Direction"
                        >
                            <i className="codicon codicon-arrow-swap"></i>
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => {
                                const newMode =
                                    cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                        ? CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
                                        : CELL_DISPLAY_MODES.INLINE;
                                onSetCellDisplayMode(newMode);
                                // Send message to update metadata
                                (window as any).vscodeApi.postMessage({
                                    command: "updateCellDisplayMode",
                                    mode: newMode,
                                });
                            }}
                            disabled={unsavedChanges}
                            title="Toggle Cell Display Mode"
                        >
                            {cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? (
                                <i className="codicon codicon-symbol-enum"></i>
                            ) : (
                                <i className="codicon codicon-symbol-constant"></i>
                            )}
                        </VSCodeButton>
                        <div
                            data-force-break-before="this div is simply here to force a break so we don't have widowed buttons"
                            style={{ display: "flex", flexDirection: "row", gap: buttonGap }}
                        >
                            {documentHasVideoAvailable && (
                                <VSCodeButton appearance="icon" onClick={handleToggleVideoPlayer}>
                                    {shouldShowVideoPlayer ? (
                                        <i className="codicon codicon-close"></i>
                                    ) : (
                                        <i className="codicon codicon-device-camera-video"></i>
                                    )}
                                </VSCodeButton>
                            )}
                            {metadata && (
                                <VSCodeButton
                                    appearance="icon"
                                    onClick={handleOpenMetadataModal}
                                    title="Edit Notebook Metadata"
                                >
                                    <i className="codicon codicon-notebook"></i>
                                </VSCodeButton>
                            )}
                        </div>
                    </div>
                )}
                <VSCodeButton
                    appearance={"icon"}
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                >
                    <i
                        className={`codicon ${
                            showAdvancedSettings ? "codicon-close" : "codicon-menu"
                        }`}
                    ></i>
                </VSCodeButton>
            </div>

            {metadata && (
                <NotebookMetadataModal
                    isOpen={isMetadataModalOpen}
                    onClose={handleCloseMetadataModal}
                    metadata={metadata}
                    onMetadataChange={onMetadataChange}
                    onSave={handleSaveMetadata}
                    onPickFile={onPickFile}
                    tempVideoUrl={tempVideoUrl}
                />
            )}
        </div>
    );
};

export default ChapterNavigation;
