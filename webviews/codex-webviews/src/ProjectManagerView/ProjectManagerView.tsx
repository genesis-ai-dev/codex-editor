import { useEffect, useState, useRef } from "react";
import {
    VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
} from "@vscode/webview-ui-toolkit/react";
import {
    ProjectManagerMessageFromWebview,
    ProjectManagerMessageToWebview,
    ProjectManagerState,
} from "../../../../types";
import { LanguageProjectStatus } from "codex-types";
import "./App.css";
import React, { CSSProperties } from "react";

declare const vscode: {
    postMessage: (message: any) => void;
};

const getLanguageDisplay = (languageObj: any): string => {
    if (!languageObj) return "Missing";
    if (typeof languageObj === "string") return languageObj;
    if (languageObj.name && typeof languageObj.name === "object") {
        const name = languageObj.name.en || Object.values(languageObj.name)[0];
        return languageObj.tag ? `${name} (${languageObj.tag})` : name;
    }
    return "Unknown";
};

// Helper component for showing validation icon legend tooltips
const ValidationLegend: React.FC<{
    position?: 'top' | 'bottom' | 'left' | 'right';
    style?: CSSProperties;
    showToSide?: boolean;
    parentRef?: React.RefObject<HTMLDivElement>;
}> = ({ position = 'bottom', style = {}, showToSide = false, parentRef }) => {
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
                tooltipRef.current.style.transform = 'none';
                
                // Check if tooltip would go off right of screen
                if (containerRect.right + tooltipRect.width + 10 > viewportWidth) {
                    // Switch to left side of icon
                    tooltipRef.current.style.left = 'auto';
                    tooltipRef.current.style.right = `${containerRect.width + 5}px`;
                }
            } else if (parentRef?.current) {
                // Center the tooltip relative to the parent field
                const parentRect = parentRef.current.getBoundingClientRect();
                const parentCenterX = parentRect.left + parentRect.width / 2;
                const tooltipWidth = tooltipRect.width;
                
                // Calculate absolute position to center the tooltip under the parent
                let leftPos = parentCenterX - tooltipWidth / 2;
                
                // Prevent tooltip from going off-screen to the left
                if (leftPos < 10) {
                    leftPos = 10;
                }
                
                // Prevent tooltip from going off-screen to the right
                if (leftPos + tooltipWidth > viewportWidth - 10) {
                    leftPos = viewportWidth - tooltipWidth - 10;
                }
                
                // Apply the absolute horizontal position
                tooltipRef.current.style.position = 'fixed';
                tooltipRef.current.style.left = `${leftPos}px`;
                tooltipRef.current.style.right = 'auto';
                
                // Position vertically below the icon
                tooltipRef.current.style.top = `${containerRect.bottom + 4}px`;
                tooltipRef.current.style.bottom = 'auto';
                
                // Remove the transform since we're positioning absolutely
                tooltipRef.current.style.transform = 'none';
            } else {
                // Center the tooltip under the icon (original behavior)
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
                tooltipRef.current.style.right = 'auto';
                
                // Check if tooltip would go off bottom of screen
                if (tooltipRect.bottom > viewportHeight - 10) {
                    tooltipRef.current.style.top = 'auto';
                    tooltipRef.current.style.bottom = `${containerRect.height + 5}px`;
                } else {
                    tooltipRef.current.style.top = `${containerRect.height + 5}px`;
                    tooltipRef.current.style.bottom = 'auto';
                }
            }
        }
    }, [showTooltip, showToSide, parentRef]);
    
    return (
        <div 
            ref={containerRef}
            style={{ 
                display: 'inline-flex', 
                position: 'relative',
                marginLeft: '6px',
                ...style 
            }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
        >
            <i 
                className="codicon codicon-info"
                style={{ 
                    color: 'var(--vscode-descriptionForeground)',
                    fontSize: '14px',
                    cursor: 'help'
                }}
            />
            {showTooltip && (
                <div 
                    ref={tooltipRef}
                    style={{
                        position: parentRef ? 'fixed' : 'absolute',
                        top: showToSide ? '-10px' : '100%',
                        left: showToSide ? '100%' : '50%',
                        transform: (parentRef || showToSide) ? 'none' : 'translateX(-50%)',
                        backgroundColor: 'var(--vscode-editor-background)',
                        border: '1px solid var(--vscode-widget-border)',
                        borderRadius: '4px',
                        padding: '8px',
                        zIndex: 1000,
                        width: 'auto',
                        maxWidth: '300px',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                        fontWeight: 'normal',
                        fontSize: '12px',
                        color: 'var(--vscode-foreground)',
                        marginTop: showToSide ? '0' : (parentRef ? '0' : '4px'),
                        lineHeight: '1.5',
                        whiteSpace: 'nowrap'
                    }}
                >
                    <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>Validation Status Icons:</div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ 
                            fontWeight: 'bold',
                            width: '16px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: '6px'
                        }}>—</span>
                        <span>Empty/Untranslated</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                        <i className="codicon codicon-circle-outline" style={{ fontSize: '12px', marginRight: '6px' }}></i>
                        <span>Without any validator</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                        <i className="codicon codicon-circle-filled" style={{ fontSize: '12px', marginRight: '6px' }}></i>
                        <span>Validated by others</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                        <div style={{ 
                            display: 'flex', 
                            marginRight: '6px',
                            width: '16px',
                            justifyContent: 'center'
                        }}>
                            <i className="codicon codicon-check" style={{ 
                                fontSize: '12px', 
                                color: 'var(--vscode-terminal-ansiGreen)' 
                            }}></i>
                        </div>
                        <span>Validated by you</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                        <div style={{ 
                            display: 'flex', 
                            marginRight: '6px',
                            width: '16px',
                            justifyContent: 'center'
                        }}>
                            <i className="codicon codicon-check-all" style={{ 
                                fontSize: '12px', 
                                color: 'var(--vscode-descriptionForeground)' 
                            }}></i>
                        </div>
                        <span>Fully validated by other users</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <div style={{ 
                            display: 'flex', 
                            marginRight: '6px',
                            width: '16px',
                            justifyContent: 'center'
                        }}>
                            <i className="codicon codicon-check-all" style={{ 
                                fontSize: '12px', 
                                color: 'var(--vscode-terminal-ansiGreen)' 
                            }}></i>
                        </div>
                        <span>Fully validated by you</span>
                    </div>
                </div>
            )}
        </div>
    );
};

// Add this helper component for consistent styling
interface ProjectFieldProps {
    label: string;
    value: React.ReactNode;
    icon?: string;
    onAction?: () => void;
    hasWarning?: boolean;
    infoTooltip?: React.ReactNode;
}

const ProjectField = ({ label, value, icon, onAction, hasWarning, infoTooltip }: ProjectFieldProps) => {
    const fieldRef = useRef<HTMLDivElement>(null);
    
    // Add parentRef to ValidationLegend if it's provided
    const tooltipWithRef = infoTooltip && React.isValidElement(infoTooltip) 
        ? React.cloneElement(infoTooltip as React.ReactElement<any>, { parentRef: fieldRef })
        : infoTooltip;
        
    return (
        <div
            ref={fieldRef}
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                padding: "0.75rem",
                backgroundColor: "var(--vscode-list-hoverBackground)",
                borderRadius: "4px",
                position: "relative"
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                }}
            >
                <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={{ fontWeight: "bold" }}>{label}</span>
                    {tooltipWithRef}
                </div>
                {onAction && icon && (
                    <VSCodeButton onClick={onAction}>
                        <i className={`codicon codicon-${icon}`}></i>
                    </VSCodeButton>
                )}
            </div>
            <div
                style={{
                    color: hasWarning ? "var(--vscode-errorForeground)" : "inherit",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                }}
            >
                {value}
                {hasWarning && <i className="codicon codicon-warning"></i>}
            </div>
        </div>
    );
};

function ProjectManagerView() {
    const [state, setState] = useState<ProjectManagerState>({
        projects: [],
        projectOverview: null,
        isScanning: false,
        watchedFolders: [],
        canInitializeProject: false,
        workspaceIsOpen: true,
        webviewReady: true,
        repoHasRemote: false,
        isInitializing: false,
    });

    const handleAction = (message: ProjectManagerMessageFromWebview) => {
        vscode.postMessage(message as ProjectManagerMessageFromWebview);
    };

    useEffect(() => {
        vscode.postMessage({ command: "checkPublishStatus" } as ProjectManagerMessageFromWebview);
    }, []);

    useEffect(() => {
        const handler = (message: MessageEvent<ProjectManagerMessageToWebview>) => {
            if (message.data.command === "stateUpdate") {
                setState(message.data.data);
            } else if (message.data.command === "publishStatus") {
                setState((prev) => ({
                    ...prev,
                    repoHasRemote: message.data.data.repoHasRemote,
                }));
            }
        };

        window.addEventListener("message", handler);

        // Initial state request
        vscode.postMessage({ command: "webviewReady" } as ProjectManagerMessageFromWebview);

        return () => {
            window.removeEventListener("message", handler);
        };
    }, []);

    // Show scanning indicator
    if (state.isScanning) {
        return (
            <div
                style={{
                    padding: "1rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                }}
            >
                <i className="codicon codicon-loading codicon-modifier-spin"></i>
                <span>Scanning projects...</span>
            </div>
        );
    }

    return (
        <div
            style={{
                height: "100vh",
                padding: "0.25rem",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <VSCodePanels>
                <VSCodePanelTab id="current-project">Current Project</VSCodePanelTab>

                <VSCodePanelView id="current-project-view">
                    {state.isInitializing ? (
                        // Initialize project button section
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                height: "100%",
                            }}
                        >
                            <VSCodeButton>
                                <i className="codicon codicon-loading codicon-modifier-spin"></i>
                                <div style={{ marginInline: "0.25rem" }}>
                                    Initializing Project...
                                </div>
                            </VSCodeButton>
                        </div>
                    ) : state.projectOverview ? (
                        // Project details section
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "1rem",
                                margin: "0 auto",
                                width: "100%",
                            }}
                        >
                            {state.projectOverview.isAuthenticated && (
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "0.5rem",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-account"></i>
                                        <span>{state.projectOverview.userName}</span>
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-mail"></i>
                                        <span>{state.projectOverview.userEmail}</span>
                                    </div>

                                    {/* <VSCodeButton onClick={() => handleAction({ command: "logout" })}></VSCodeButton> */}
                                </div>
                            )}
                            <ProjectField
                                label="Project Name"
                                value={state.projectOverview.projectName ?? "Missing"}
                                icon="pencil"
                                onAction={() => handleAction({ command: "renameProject" })}
                                hasWarning={!state.projectOverview.projectName}
                            />
                            <ProjectField
                                label="Source Language"
                                value={getLanguageDisplay(state.projectOverview?.sourceLanguage)}
                                icon="source-control"
                                onAction={() =>
                                    handleAction({
                                        command: "changeSourceLanguage",
                                        language: state.projectOverview?.sourceLanguage || {
                                            name: { en: "Unknown" },
                                            tag: "unknown",
                                            refName: "Unknown",
                                            projectStatus: LanguageProjectStatus.SOURCE,
                                        },
                                    })
                                }
                                hasWarning={!state.projectOverview?.sourceLanguage}
                            />
                            <ProjectField
                                label="Target Language"
                                value={getLanguageDisplay(state.projectOverview?.targetLanguage)}
                                icon="globe"
                                onAction={() =>
                                    handleAction({
                                        command: "changeTargetLanguage",
                                        language: state.projectOverview?.targetLanguage || {
                                            name: { en: "Unknown" },
                                            tag: "unknown",
                                            refName: "Unknown",
                                            projectStatus: LanguageProjectStatus.TARGET,
                                        },
                                    })
                                }
                                hasWarning={!state.projectOverview?.targetLanguage}
                            />
                            {/* <ProjectField
                                label="Abbreviation"
                                value={state.projectOverview.abbreviation?.toString() ?? "Missing"}
                                icon="pencil"
                                onAction={() => handleAction({ command: "editAbbreviation" })}
                                hasWarning={!state.projectOverview.abbreviation}
                            /> */}
                            <ProjectField
                                label="Required Validations"
                                value={String(state.projectOverview.validationCount || 1)}
                                icon="check"
                                onAction={() => handleAction({ command: "setValidationCount" })}
                                hasWarning={!state.projectOverview.validationCount}
                                infoTooltip={<ValidationLegend position="bottom" showToSide={false} />}
                            />
                            <ProjectField
                                label="Project Documents"
                                value={
                                    state.projectOverview.sourceTexts &&
                                    state.projectOverview.sourceTexts.length > 0
                                        ? `${state.projectOverview.sourceTexts.length} texts`
                                        : "Missing"
                                }
                                icon="new-file"
                                onAction={() => handleAction({ command: "openSourceUpload" })}
                                hasWarning={!state.projectOverview.sourceTexts?.length}
                            />
                            <ProjectField
                                label="Spellcheck"
                                value={
                                    state.projectOverview.spellcheckIsEnabled
                                        ? "Spellcheck is enabled"
                                        : "Spellcheck is disabled"
                                }
                                icon="warning"
                                onAction={() => handleAction({ command: "toggleSpellcheck" })}
                                // hasWarning={}
                            />
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "1rem",
                                    flexWrap: "wrap",
                                    marginTop: "1rem",
                                }}
                            >
                                <VSCodeButton
                                    onClick={() => handleAction({ command: "openAISettings" })}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-settings"></i> Copilot
                                        Settings
                                    </div>
                                </VSCodeButton>

                                <VSCodeButton
                                    onClick={() => handleAction({ command: "openEditAnalysis" })}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-graph"></i> AI Metrics
                                    </div>
                                </VSCodeButton>

                                <VSCodeButton
                                    onClick={() => handleAction({ command: "openExportView" })}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-export"></i> Export Project
                                    </div>
                                </VSCodeButton>

                                {!state.repoHasRemote && (
                                    <VSCodeButton
                                        onClick={() => handleAction({ command: "publishProject" })}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "0.5rem",
                                            }}
                                        >
                                            <i className="codicon codicon-cloud-upload"></i> Publish
                                            Project
                                        </div>
                                    </VSCodeButton>
                                )}
                                {state.repoHasRemote && (
                                    <VSCodeButton
                                        onClick={() => handleAction({ command: "syncProject" })}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "0.5rem",
                                            }}
                                        >
                                            <i className="codicon codicon-sync"></i> Sync Project
                                        </div>
                                    </VSCodeButton>
                                )}
                                <VSCodeButton
                                    onClick={() => handleAction({ command: "closeProject" })}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                        }}
                                    >
                                        <i className="codicon codicon-close"></i> Close Project
                                    </div>
                                </VSCodeButton>
                            </div>
                        </div>
                    ) : (
                        // No project message
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                height: "100%",
                            }}
                        >
                            <span>No project found in current workspace</span>
                        </div>
                    )}
                </VSCodePanelView>
            </VSCodePanels>
        </div>
    );
}

export default ProjectManagerView;
