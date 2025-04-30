import React, { useState, useEffect, CSSProperties, useRef, useCallback } from "react";
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
        includeNotValidatedByCurrentUser: boolean,
        includeFullyValidatedByOthers: boolean
    ) => void;
    totalUntranslatedCells: number;
    totalCellsToAutocomplete: number;
    totalCellsWithCurrentUserOption: number;
    totalFullyValidatedByOthers?: number;
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
    totalFullyValidatedByOthers = 0,
    defaultValue = Math.min(5, totalUntranslatedCells > 0 ? totalUntranslatedCells : 5),
}) => {
    // State for number of cells to autocomplete
    const [numberOfCellsToAutocomplete, setNumberOfCellsToAutocomplete] = useState(
        totalUntranslatedCells > 0 ? defaultValue : 0
    );
    const [customValue, setCustomValue] = useState(totalUntranslatedCells > 0 ? defaultValue : 0);
    
    // Individual states for each cell type
    const [includeEmptyCells, setIncludeEmptyCells] = useState(true);
    const [includeNotValidatedByAnyUser, setIncludeNotValidatedByAnyUser] = useState(false);
    const [includeNotValidatedByCurrentUser, setIncludeNotValidatedByCurrentUser] = useState(false);
    const [includeFullyValidatedByOthers, setIncludeFullyValidatedByOthers] = useState(false);
    
    // Show warning dialog for fully validated cells
    const [showValidationWarning, setShowValidationWarning] = useState(false);
    
    // Start with base total - only cells with no content
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

    // Calculate the effective total cells based on selected options
    useEffect(() => {
        let total = 0;
        
        if (includeEmptyCells) {
            total += totalUntranslatedCells;
        }
        
        if (includeNotValidatedByAnyUser) {
            // Add cells with content but no validation
            total += totalCellsToAutocomplete - totalUntranslatedCells;
        }
        
        if (includeNotValidatedByCurrentUser) {
            // Add cells validated by others but not by current user
            // Avoid double-counting
            const additionalCells = totalCellsWithCurrentUserOption - 
                (includeNotValidatedByAnyUser ? totalCellsToAutocomplete : totalUntranslatedCells);
            total += Math.max(0, additionalCells);
        }
        
        if (includeFullyValidatedByOthers) {
            // Add fully validated cells by others
            total += totalFullyValidatedByOthers;
        }
        
        setEffectiveTotalCells(total);
        
        // Adjust numberOfCellsToAutocomplete if needed
        if (total === 0) {
            setNumberOfCellsToAutocomplete(0);
            setCustomValue(0);
        } else if (numberOfCellsToAutocomplete > total) {
            setNumberOfCellsToAutocomplete(total);
            setCustomValue(total);
        } else if (numberOfCellsToAutocomplete === 0 && total > 0) {
            const newValue = Math.min(5, total);
            setNumberOfCellsToAutocomplete(newValue);
            setCustomValue(newValue);
        }
    }, [
        includeEmptyCells,
        includeNotValidatedByAnyUser,
        includeNotValidatedByCurrentUser,
        includeFullyValidatedByOthers,
        totalUntranslatedCells,
        totalCellsToAutocomplete,
        totalCellsWithCurrentUserOption,
        numberOfCellsToAutocomplete,
        totalFullyValidatedByOthers
    ]);
    
    // Handle selection toggle for cell type cards
    const toggleCellTypeSelection = (type: 'empty' | 'no-validator' | 'not-current-user' | 'fully-validated') => {
        switch (type) {
            case 'empty':
                setIncludeEmptyCells(!includeEmptyCells);
                break;
            case 'no-validator':
                setIncludeNotValidatedByAnyUser(!includeNotValidatedByAnyUser);
                break;
            case 'not-current-user':
                setIncludeNotValidatedByCurrentUser(!includeNotValidatedByCurrentUser);
                break;
            case 'fully-validated':
                if (!includeFullyValidatedByOthers) {
                    // Show warning before enabling
                    setShowValidationWarning(true);
                } else {
                    setIncludeFullyValidatedByOthers(!includeFullyValidatedByOthers);
                }
                break;
        }
    };
    
    // Confirmation handler
    const handleConfirm = () => {
        onConfirm(
            numberOfCellsToAutocomplete,
            includeNotValidatedByAnyUser,
            includeNotValidatedByCurrentUser,
            includeFullyValidatedByOthers
        );
    };
    
    // Warning dialog confirmation handler
    const handleConfirmWarning = () => {
        setShowValidationWarning(false);
        setIncludeFullyValidatedByOthers(true);
    };

    if (!isOpen || !modalContainer) return null;

    // Render the selection card for a cell type
    const renderCellTypeCard = (
        type: 'empty' | 'no-validator' | 'not-current-user' | 'fully-validated',
        title: string,
        description: string,
        icon: React.ReactNode,
        count: number,
        isSelected: boolean
    ) => {
        const isDisabled = count === 0;
        
        return (
            <div
                className="cell-type-card"
                onClick={() => !isDisabled && toggleCellTypeSelection(type)}
                style={{
                    backgroundColor: isSelected 
                        ? "var(--vscode-button-background, #0e639c)" 
                        : "var(--vscode-editor-background)",
                    border: `1px solid ${isSelected 
                        ? "var(--vscode-focusBorder, #007fd4)" 
                        : "var(--vscode-widget-border)"}`,
                    borderRadius: "6px",
                    padding: "14px",
                    cursor: isDisabled ? "not-allowed" : "pointer",
                    opacity: isDisabled ? 0.5 : 1,
                    transition: "all 0.2s ease",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    boxShadow: isSelected 
                        ? "0 0 0 1px var(--vscode-focusBorder)"
                        : "none",
                    position: "relative",
                    overflow: "hidden",
                    height: "100%"
                }}
            >
                <div style={{ 
                    position: "absolute", 
                    top: "10px", 
                    right: "10px", 
                    width: "16px", 
                    height: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isSelected 
                        ? "var(--vscode-button-foreground, #ffffff)"
                        : "transparent",
                    borderRadius: "50%",
                    border: isSelected
                        ? "none"
                        : "1px solid var(--vscode-descriptionForeground)",
                }}>
                    {isSelected && (
                        <i 
                            className="codicon codicon-check" 
                            style={{ 
                                fontSize: "12px", 
                                color: "var(--vscode-button-background, #0e639c)"
                            }}
                        />
                    )}
                </div>
                <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: "8px",
                    color: isSelected 
                        ? "var(--vscode-button-foreground, #ffffff)" 
                        : "var(--vscode-foreground)"
                }}>
                    <div style={{
                        width: "24px", 
                        height: "24px", 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "center",
                        backgroundColor: isSelected ? 
                            "rgba(255, 255, 255, 0.15)" : 
                            "var(--vscode-editorWidget-background)",
                        borderRadius: "4px"
                    }}>
                        {icon}
                    </div>
                    <div style={{ fontWeight: "600" }}>{title}</div>
                </div>
                <div style={{ 
                    fontSize: "12px", 
                    color: isSelected 
                        ? "var(--vscode-button-foreground, #ffffff)" 
                        : "var(--vscode-descriptionForeground)",
                    flex: 1
                }}>
                    {description}
                </div>
                <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "flex-start",
                    marginTop: "4px"
                }}>
                    <div style={{
                        backgroundColor: isSelected 
                            ? "rgba(255, 255, 255, 0.2)" 
                            : "var(--vscode-badge-background)",
                        color: isSelected 
                            ? "var(--vscode-button-foreground, #ffffff)" 
                            : "var(--vscode-badge-foreground)",
                        borderRadius: "10px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: "600",
                        display: "inline-block"
                    }}>
                        {count} cells
                    </div>
                </div>
            </div>
        );
    };

    // Use a portal to render the modal at the document body level
    return ReactDOM.createPortal(
        <>
            <div
                className="modal-overlay"
                onClick={(e) => {
                    // Close when clicking the overlay (outside the modal)
                    if (e.target === e.currentTarget) {
                        onClose();
                    }
                }}
                style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 9999
                }}
            >
                <div 
                    className="modal-content" 
                    ref={modalRef} 
                    tabIndex={-1}
                    style={{
                        backgroundColor: "var(--vscode-editor-background)",
                        border: "1px solid var(--vscode-widget-border)",
                        borderRadius: "6px",
                        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                        padding: "20px",
                        width: "580px",
                        maxWidth: "90vw",
                        maxHeight: "90vh",
                        overflow: "auto",
                        position: "relative"
                    }}
                >
                    <div style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        marginBottom: "20px",
                        justifyContent: "space-between" 
                    }}>
                        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "600" }}>Autocomplete Cells</h2>
                        <ValidationLegend position="right" showToSide={true} />
                    </div>
                    
                    <div style={{ 
                        display: "grid", 
                        gridTemplateColumns: "repeat(2, 1fr)", 
                        gap: "16px", 
                        marginBottom: "20px" 
                    }}>
                        {/* Empty/Untranslated Cells Card */}
                        {renderCellTypeCard(
                            'empty',
                            'Empty Cells',
                            'Cells with no content',
                            <span style={{ 
                                fontWeight: "bold", 
                                width: "16px", 
                                height: "16px", 
                                display: "inline-flex", 
                                alignItems: "center", 
                                justifyContent: "center",
                                color: includeEmptyCells 
                                    ? "var(--vscode-button-foreground, #ffffff)" 
                                    : "var(--vscode-descriptionForeground)"
                            }}>—</span>,
                            totalUntranslatedCells,
                            includeEmptyCells
                        )}
                        
                        {/* Cells without any validator Card */}
                        {renderCellTypeCard(
                            'no-validator',
                            'No Validator',
                            'Cells with content but no validator',
                            <i className="codicon codicon-circle-outline" style={{ 
                                fontSize: "16px",
                                color: includeNotValidatedByAnyUser 
                                    ? "var(--vscode-button-foreground, #ffffff)" 
                                    : "var(--vscode-descriptionForeground)"
                            }}></i>,
                            totalCellsToAutocomplete - totalUntranslatedCells,
                            includeNotValidatedByAnyUser
                        )}
                        
                        {/* Cells not validated by current user Card */}
                        {renderCellTypeCard(
                            'not-current-user',
                            'Not Validated by You',
                            'Cells validated by others but not by you',
                            <i className="codicon codicon-circle-filled" style={{ 
                                fontSize: "16px",
                                color: includeNotValidatedByCurrentUser 
                                    ? "var(--vscode-button-foreground, #ffffff)" 
                                    : "var(--vscode-descriptionForeground)"
                            }}></i>,
                            totalCellsWithCurrentUserOption - totalCellsToAutocomplete,
                            includeNotValidatedByCurrentUser
                        )}
                        
                        {/* Fully validated by others Card */}
                        {renderCellTypeCard(
                            'fully-validated',
                            'Fully Validated',
                            'Cells already fully validated by other users',
                            <i className="codicon codicon-check-all" style={{ 
                                fontSize: "16px",
                                color: includeFullyValidatedByOthers 
                                    ? "var(--vscode-button-foreground, #ffffff)" 
                                    : "var(--vscode-descriptionForeground)"
                            }}></i>,
                            totalFullyValidatedByOthers,
                            includeFullyValidatedByOthers
                        )}
                    </div>
                    
                    <div style={{ marginBottom: "20px" }}>
                        <div style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            marginBottom: "10px",
                            gap: "8px" 
                        }}>
                            <label style={{ fontWeight: 600 }}>
                                Number of cells to autocomplete:
                            </label>
                            
                            <div style={{ 
                                display: "flex",
                                alignItems: "center", 
                                gap: "8px",
                                marginLeft: "auto" 
                            }}>
                                <input
                                    type="number"
                                    min="1"
                                    max={effectiveTotalCells}
                                    value={customValue === 0 && effectiveTotalCells === 0 ? "0" : Math.min(customValue || 0, effectiveTotalCells)}
                                    onChange={(e) => {
                                        const value = parseInt(e.target.value);
                                        if (!isNaN(value) && value >= 0) {
                                            const cappedValue = Math.min(value, effectiveTotalCells);
                                            setCustomValue(cappedValue);
                                            setNumberOfCellsToAutocomplete(cappedValue);
                                        } else {
                                            setCustomValue(0);
                                            setNumberOfCellsToAutocomplete(0);
                                        }
                                    }}
                                    className="autocomplete-number-input"
                                    style={{
                                        width: "80px",
                                        border: "1px solid var(--vscode-input-border, var(--vscode-widget-border))",
                                        borderRadius: "4px",
                                        padding: "4px 8px",
                                        outline: "none",
                                        height: "28px", /* Match VSCodeButton height */
                                        backgroundColor: "var(--vscode-input-background)",
                                        color: "var(--vscode-input-foreground)",
                                        fontSize: "13px",
                                        boxSizing: "border-box"
                                    }}
                                    disabled={effectiveTotalCells === 0}
                                />
                                
                                <VSCodeButton 
                                    onClick={() => {
                                        setNumberOfCellsToAutocomplete(effectiveTotalCells);
                                        setCustomValue(effectiveTotalCells);
                                    }}
                                    disabled={effectiveTotalCells === 0}
                                >
                                    All ({effectiveTotalCells})
                                </VSCodeButton>
                            </div>
                        </div>
                        
                        {/* Selected cell types summary */}
                        <div style={{
                            padding: "10px",
                            backgroundColor: "var(--vscode-editorWidget-background)",
                            borderRadius: "4px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px"
                        }}>
                            <div style={{ fontWeight: "600", fontSize: "13px" }}>Selected cell types:</div>
                            <div style={{ 
                                display: "flex", 
                                gap: "8px",
                                flexWrap: "wrap" 
                            }}>
                                {includeEmptyCells && (
                                    <VSCodeTag>Empty Cells</VSCodeTag>
                                )}
                                {includeNotValidatedByAnyUser && (
                                    <VSCodeTag>No Validator</VSCodeTag>
                                )}
                                {includeNotValidatedByCurrentUser && (
                                    <VSCodeTag>Not Validated by You</VSCodeTag>
                                )}
                                {includeFullyValidatedByOthers && (
                                    <VSCodeTag>Fully Validated</VSCodeTag>
                                )}
                                {!includeEmptyCells && !includeNotValidatedByAnyUser && 
                                 !includeNotValidatedByCurrentUser && !includeFullyValidatedByOthers && (
                                    <span style={{ 
                                        color: "var(--vscode-errorForeground)", 
                                        fontSize: "13px" 
                                    }}>
                                        No cell types selected
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="modal-actions" style={{ 
                        display: "flex", 
                        justifyContent: "flex-end",
                        gap: "8px",
                        marginTop: "20px" 
                    }}>
                        <VSCodeButton 
                            onClick={onClose} 
                            appearance="secondary"
                        >
                            Cancel
                        </VSCodeButton>
                        <VSCodeButton
                            onClick={handleConfirm}
                            disabled={numberOfCellsToAutocomplete === 0 || 
                                    (!includeEmptyCells && !includeNotValidatedByAnyUser && 
                                    !includeNotValidatedByCurrentUser && !includeFullyValidatedByOthers)}
                        >
                            Autocomplete {numberOfCellsToAutocomplete} Cells
                        </VSCodeButton>
                    </div>
                </div>
            </div>
            
            {/* Warning dialog for fully validated cells */}
            {showValidationWarning && (
                <div className="warning-dialog-overlay" style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 10000
                }}>
                    <div className="warning-dialog" style={{
                        backgroundColor: "var(--vscode-editor-background)",
                        border: "1px solid var(--vscode-editorWarning-border, #cca700)",
                        borderRadius: "6px",
                        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
                        padding: "20px",
                        width: "400px",
                        maxWidth: "90vw"
                    }}>
                        <div style={{ 
                            display: "flex", 
                            alignItems: "flex-start", 
                            gap: "12px", 
                            marginBottom: "16px" 
                        }}>
                            <i 
                                className="codicon codicon-warning" 
                                style={{ 
                                    fontSize: "20px", 
                                    color: "var(--vscode-editorWarning-foreground, #cca700)",
                                    marginTop: "2px"
                                }}
                            />
                            <div>
                                <h3 style={{ 
                                    margin: "0 0 8px 0", 
                                    color: "var(--vscode-editorWarning-foreground, #cca700)" 
                                }}>
                                    Warning: Selecting Fully Validated Cells
                                </h3>
                                <p style={{ margin: "0 0 8px 0" }}>
                                    These cells have already been fully validated by other users, 
                                    meaning they've gone through multiple validation passes.
                                </p>
                                <p style={{ margin: "0" }}>
                                    Are you sure you want to include them for autocomplete?
                                </p>
                            </div>
                        </div>
                        <div style={{ 
                            display: "flex", 
                            justifyContent: "flex-end", 
                            gap: "8px" 
                        }}>
                            <VSCodeButton 
                                appearance="secondary" 
                                onClick={() => setShowValidationWarning(false)}
                            >
                                Cancel
                            </VSCodeButton>
                            <VSCodeButton 
                                onClick={handleConfirmWarning}
                            >
                                Include Anyway
                            </VSCodeButton>
                        </div>
                    </div>
                </div>
            )}
        </>,
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
        includeNotValidatedByCurrentUser: boolean,
        includeFullyValidatedByOthers: boolean
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
    bibleBookMap?: Map<string, { name: string; [key: string]: any }>;
    vscode: any;
    fileStatus?: "dirty" | "syncing" | "synced" | "none";
    onClose?: () => void;
    onTriggerSync?: () => void;
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
    bibleBookMap,
    vscode,
    fileStatus = "none",
    onClose,
    onTriggerSync,
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
        includeNotValidatedByCurrentUser: boolean,
        includeFullyValidatedByOthers = false
    ) => {
        console.log("Confirm autocomplete:", {
            numberOfCells,
            includeNotValidatedByAnyUser,
            includeNotValidatedByCurrentUser,
            includeFullyValidatedByOthers,
            totalCellsToAutocomplete,
            totalCellsWithCurrentUserOption,
        });
        onAutocompleteChapter(
            numberOfCells,
            includeNotValidatedByAnyUser,
            includeNotValidatedByCurrentUser,
            includeFullyValidatedByOthers
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

    // Determine the display name using the map
    const getDisplayTitle = () => {
        const firstMarker = translationUnitsForSection[0]?.cellMarkers?.[0]?.split(":")[0]; // e.g., "GEN 1"
        if (!firstMarker) return "Chapter"; // Fallback title

        const parts = firstMarker.split(" ");
        const bookAbbr = parts[0]; // e.g., "GEN"
        const chapterNum = parts[1] || ""; // e.g., "1"

        // Look up the localized name
        const localizedName = bibleBookMap?.get(bookAbbr)?.name;

        // Use localized name if found, otherwise use the abbreviation
        const displayBookName = localizedName || bookAbbr;

        return `${displayBookName}\u00A0${chapterNum}`;
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

    // Function to get file status icon and color
    const getFileStatusButton = () => {
        if (fileStatus === "none") return null;

        let icon: string;
        let color: string;
        let title: string;
        let clickHandler: (() => void) | undefined = undefined;

        switch (fileStatus) {
            case "dirty":
                icon = "codicon-cloud";
                color = "var(--vscode-editorWarning-foreground)"; // Yellow warning color
                title = "Unsaved changes - Click to sync";
                clickHandler = onTriggerSync;
                break;
            case "syncing":
                icon = "codicon-sync";
                color = "var(--vscode-descriptionForeground)"; // Gray for syncing
                title = "Syncing changes";
                break;
            case "synced":
                icon = "codicon-check-all";
                color = "var(--vscode-terminal-ansiGreen)"; // Green for synced
                title = "All changes saved";
                break;
            default:
                return null;
        }

        return (
            <VSCodeButton
                appearance="icon"
                title={title}
                style={{ color }}
                onClick={clickHandler}
                disabled={fileStatus === "syncing"}
            >
                <i
                    className={`codicon ${icon}`}
                    style={{
                        animation: fileStatus === "syncing" ? "rotate 2s linear infinite" : "none",
                    }}
                />
            </VSCodeButton>
        );
    };

    // Add CSS for rotation animation
    useEffect(() => {
        if (!document.getElementById("codex-animation-styles")) {
            const styleElement = document.createElement("style");
            styleElement.id = "codex-animation-styles";
            styleElement.textContent = `
                @keyframes rotate {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(styleElement);
        }
    }, []);

    // Add this style to the component to handle input focus state
    useEffect(() => {
        if (!document.getElementById("autocomplete-custom-styles")) {
            const styleElement = document.createElement("style");
            styleElement.id = "autocomplete-custom-styles";
            styleElement.textContent = `
                .autocomplete-number-input:focus {
                    border-color: var(--vscode-focusBorder) !important;
                    outline: none;
                    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
                }
            `;
            document.head.appendChild(styleElement);
        }
        return () => {
            const style = document.getElementById("autocomplete-custom-styles");
            if (style) style.remove();
        };
    }, []);

    // Handle close button click
    const handleClose = () => {
        if (onClose) {
            onClose();
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
                <VSCodeButton
                    appearance="icon"
                    disabled={unsavedChanges}
                    onClick={() => {
                        if (!unsavedChanges) {
                            const newChapter =
                                chapterNumber === 1 ? totalChapters : chapterNumber - 1;
                            (window as any).vscodeApi.postMessage({
                                command: "jumpToChapter",
                                chapterNumber: newChapter,
                            });
                            setChapterNumber(newChapter);
                        }
                    }}
                    title={
                        unsavedChanges ? "Save changes first to change chapter" : "Previous Chapter"
                    }
                >
                    <i
                        className={`codicon ${
                            textDirection === "rtl"
                                ? "codicon-chevron-right"
                                : "codicon-chevron-left"
                        }`}
                    ></i>
                </VSCodeButton>
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
                        backgroundColor: "var(--vscode-button-background, #0e639c)",
                        border: "1px solid var(--vscode-contrastBorder, transparent)",
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
                                "var(--vscode-button-hoverBackground, #1177bb)";
                            e.currentTarget.style.boxShadow =
                                "0 0 0 1px var(--vscode-focusBorder, rgba(0, 122, 204, 0.4))";
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor =
                            "var(--vscode-button-background, #0e639c)";
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
                            color: "var(--vscode-button-foreground, #ffffff)",
                        }}
                    >
                        {getDisplayTitle()}
                        <i
                            className="codicon codicon-chevron-down"
                            style={{
                                fontSize: "0.85rem",
                                marginLeft: "0.5rem",
                                opacity: 0.9,
                                color: "var(--vscode-button-foreground, #ffffff)",
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
                <VSCodeButton
                    appearance="icon"
                    disabled={unsavedChanges}
                    onClick={() => {
                        if (!unsavedChanges) {
                            const newChapter =
                                chapterNumber === totalChapters ? 1 : chapterNumber + 1;
                            (window as any).vscodeApi.postMessage({
                                command: "jumpToChapter",
                                chapterNumber: newChapter,
                            });
                            setChapterNumber(newChapter);
                        }
                    }}
                    title={unsavedChanges ? "Save changes first to change chapter" : "Next Chapter"}
                >
                    <i
                        className={`codicon ${
                            textDirection === "rtl"
                                ? "codicon-chevron-left"
                                : "codicon-chevron-right"
                        }`}
                    ></i>
                </VSCodeButton>

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
                {/* File status indicator */}
                {getFileStatusButton()}

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
                            totalFullyValidatedByOthers={Math.round(totalCellsWithCurrentUserOption * 0.2)}
                            defaultValue={Math.min(
                                5,
                                totalUntranslatedCells > 0 ? totalUntranslatedCells : 5
                            )}
                        />
                    </>
                )}

                {showAdvancedSettings && (
                    <div
                        className="advanced-settings-container"
                        style={{
                            position: "absolute",
                            top: "100%",
                            right: "0",
                            backgroundColor: "var(--vscode-menu-background)",
                            border: "1px solid var(--vscode-menu-border)",
                            borderRadius: "4px",
                            padding: "0.5rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                            zIndex: 100,
                            boxShadow: "0 2px 8px var(--vscode-widget-shadow)",
                            minWidth: "200px",
                        }}
                    >
                        <VSCodeButton
                            appearance="secondary"
                            onClick={() =>
                                onSetTextDirection(textDirection === "ltr" ? "rtl" : "ltr")
                            }
                            disabled={unsavedChanges}
                            title="Set Text Direction"
                            style={{
                                display: "flex",
                                justifyContent: "flex-start",
                                padding: "0.5rem",
                                width: "100%",
                            }}
                        >
                            <i
                                className="codicon codicon-arrow-swap"
                                style={{ marginInlineEnd: "0.5rem" }}
                            ></i>
                            Text Direction
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="secondary"
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
                            style={{
                                display: "flex",
                                justifyContent: "flex-start",
                                padding: "0.5rem",
                                width: "100%",
                            }}
                        >
                            {cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? (
                                <i
                                    className="codicon codicon-symbol-enum"
                                    style={{ marginInlineEnd: "0.5rem" }}
                                ></i>
                            ) : (
                                <i
                                    className="codicon codicon-symbol-constant"
                                    style={{ marginInlineEnd: "0.5rem" }}
                                ></i>
                            )}
                            Display Mode
                        </VSCodeButton>
                        {documentHasVideoAvailable && (
                            <VSCodeButton
                                appearance="secondary"
                                onClick={handleToggleVideoPlayer}
                                style={{
                                    display: "flex",
                                    justifyContent: "flex-start",
                                    padding: "0.5rem",
                                    width: "100%",
                                }}
                            >
                                {shouldShowVideoPlayer ? (
                                    <i
                                        className="codicon codicon-close"
                                        style={{ marginInlineEnd: "0.5rem" }}
                                    ></i>
                                ) : (
                                    <i
                                        className="codicon codicon-device-camera-video"
                                        style={{ marginInlineEnd: "0.5rem" }}
                                    ></i>
                                )}
                                Toggle Video
                            </VSCodeButton>
                        )}
                        {metadata && (
                            <VSCodeButton
                                appearance="secondary"
                                onClick={handleOpenMetadataModal}
                                title="Edit Notebook Metadata"
                                style={{
                                    display: "flex",
                                    justifyContent: "flex-start",
                                    padding: "0.5rem",
                                    width: "100%",
                                }}
                            >
                                <i
                                    className="codicon codicon-notebook"
                                    style={{ marginInlineEnd: "0.5rem" }}
                                ></i>
                                Edit Metadata
                            </VSCodeButton>
                        )}
                    </div>
                )}
                <VSCodeButton
                    appearance={"icon"}
                    onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                    style={{
                        backgroundColor: "var(--vscode-button-background, #0e639c)",
                        borderRadius: "4px",
                        border: "1px solid var(--vscode-contrastBorder, transparent)",
                        color: "var(--vscode-button-foreground, #ffffff)",
                    }}
                >
                    <i
                        className={`codicon ${
                            showAdvancedSettings ? "codicon-chevron-up" : "codicon-chevron-down"
                        }`}
                        style={{
                            color: "var(--vscode-button-foreground, #ffffff)",
                        }}
                    ></i>
                </VSCodeButton>

                {/* Close button */}
                {/* <VSCodeButton
                    appearance="icon"
                    onClick={() => {
                        if (vscode) {
                            const message = {
                                command: "closeCurrentDocument",
                                content: {
                                    isSource: isSourceText,
                                    uri:
                                        (window as any).initialData?.metadata?.sourceFsPath ||
                                        (window as any).initialData?.metadata?.codexFsPath,
                                },
                            };
                            console.log("Sending close message:", message);
                            vscode.postMessage(message);
                        }
                    }}
                    title="Close Editor"
                    style={{
                        marginLeft: "0.5rem",
                        backgroundColor:
                            "var(--vscode-editorError-background, rgba(255, 0, 0, 0.1))",
                        border: "1px solid var(--vscode-editorError-border, rgba(255, 0, 0, 0.3))",
                        borderRadius: "4px",
                    }}
                >
                    <i className="codicon codicon-close"></i>
                </VSCodeButton> */}
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
