import React, {
    useRef,
    useEffect,
    useMemo,
    useState,
    useContext,
    forwardRef,
    useImperativeHandle,
} from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import registerQuillSpellChecker, {
    getCleanedHtml,
    QuillSpellChecker,
} from "./react-quill-spellcheck";
import { EditHistory, EditorPostMessages, SpellCheckResponse } from "../../../../types";
import "./Editor.css";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import ReactPlayer from "react-player";
import { diffWords } from "diff";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { processHtmlContent, updateFootnoteNumbering } from "./footnoteUtils";
import { ABTestVariantSelector } from "./components/ABTestVariantSelector";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";

const icons: any = Quill.import("ui/icons");
const vscode: any = (window as any).vscodeApi;

registerQuillSpellChecker(Quill, vscode);

interface ABTestState {
    isActive: boolean;
    variants: string[];
    cellId: string;
    testId: string;
    testName?: string;
    names?: string[];
    // Attention check metadata
    isAttentionCheck?: boolean;
    correctIndex?: number;
    decoyCellId?: string;
    // Recovery state - shown after wrong attention check selection
    isRecovery?: boolean;
    recoveryMessage?: string;
}

export interface EditorRef {
    quillRef: React.RefObject<Quill>;
    printContents: () => void;
    getSelection: () => { text: string; html: string } | null;
    getCurrentLineId: () => string | undefined;
    setSelectionToRange: (from: number, to: number) => void;
    focus: () => void;
    clearSelection: () => void;
    addText: (text: string) => void;
    isEnabled: () => boolean;
    setIsEnabled: (isEnabled: boolean) => void;
    showHistory: () => void;
    setShowHistory: (showHistory: boolean) => void;
    getCleanTextFromQuill: () => string;
    getQuillContent: () => string;
    deleteText: (from: number, to: number) => void;
    insertText: (position: number, text: string) => void;
}

interface EditorProps {
    currentLineId: string;
    currentLineIndex: number;
    content: string;
    readOnly: boolean;
    fontFamily?: string;
    fontSizeClass?: string;
    isRTL?: boolean;
    onReady?: () => void;
    onChange?: (data: {
        text: string;
        html: string;
        wordCount: number;
        editHistory?: EditHistory;
    }) => void;
    onCursorChangeUpdated?: (cursorIndex: number, selectionLength: number) => void;
    onEditorFocused?: () => void;
    onEditorBlurred?: () => void;
    showTranslationHelper?: boolean;
    isSourceText?: boolean;
    onSelectionChange?: (range: any) => void;
    setSpellCheckResponse: React.Dispatch<React.SetStateAction<SpellCheckResponse | null>>;
    hasUnsavedChanges?: boolean;
}

const EditorWithABTesting = forwardRef<EditorRef, EditorProps>((props, ref) => {
    const quillRef = useRef<Quill | null>(null);
    const [quillContainer, setQuillContainer] = useState<HTMLDivElement | null>(null);
    const { unsavedChanges, setUnsavedChanges } = useContext(UnsavedChangesContext);
    const [spellChecker, setSpellChecker] = useState<QuillSpellChecker | null>(null);
    const [isEnabled, setIsEnabled] = useState(true);
    const [showHistory, setShowHistory] = useState(false);
    const [abTestState, setAbTestState] = useState<ABTestState>({
        isActive: false,
        variants: [],
        cellId: '',
        testId: '',
        testName: ''
    });

    // A/B Testing handlers
    const handleShowABTestVariants = (data: { variants: string[]; cellId: string; testId: string; }) => {
        setAbTestState({
            isActive: true,
            variants: data.variants,
            cellId: data.cellId,
            testId: data.testId
        });
    };

    const handleVariantSelected = (selectedIndex: number, selectionTimeMs: number) => {
        if (!abTestState.isActive) return;

        // Check if this is an attention check and they selected the wrong option
        if (abTestState.isAttentionCheck &&
            typeof abTestState.correctIndex === 'number' &&
            selectedIndex !== abTestState.correctIndex &&
            !abTestState.isRecovery) {

            // Wrong selection on attention check - trigger recovery
            const correctVariant = abTestState.variants[abTestState.correctIndex];

            // Send feedback to backend (record the failure)
            vscode.postMessage({
                command: "selectABTestVariant",
                content: {
                    cellId: abTestState.cellId,
                    selectedIndex,
                    testId: abTestState.testId,
                    testName: abTestState.testName,
                    selectionTimeMs,
                    totalVariants: abTestState.variants?.length ?? 0,
                    names: abTestState.names,
                    // Attention check specific
                    isAttentionCheck: true,
                    attentionCheckPassed: false,
                    correctIndex: abTestState.correctIndex,
                    decoyCellId: abTestState.decoyCellId
                }
            } as unknown as EditorPostMessages);

            // Show recovery with "Let's look at another" - both options are correct
            setAbTestState({
                ...abTestState,
                isRecovery: true,
                recoveryMessage: "Let's look at another",
                variants: [correctVariant, correctVariant], // Both identical correct variants
                names: undefined, // Don't show names in recovery
                isAttentionCheck: false, // No longer an attention check
                correctIndex: undefined,
            });
            return;
        }

        const selectedVariant = abTestState.variants[selectedIndex];

        // Apply the selected variant to the editor
        if (quillRef.current && abTestState.cellId === props.currentLineId) {
            quillRef.current.root.innerHTML = selectedVariant;
            props.onChange?.({
                html: quillRef.current.root.innerHTML,
                text: quillRef.current.getText(),
                wordCount: quillRef.current.getText().trim().split(/\s+/).length
            });
            setUnsavedChanges(true);
        }

        // Send feedback to backend
        vscode.postMessage({
            command: "selectABTestVariant",
            content: {
                cellId: abTestState.cellId,
                selectedIndex,
                testId: abTestState.testId,
                testName: abTestState.testName,
                selectionTimeMs,
                totalVariants: abTestState.variants?.length ?? 0,
                names: abTestState.names,
                // Attention check specific (if applicable)
                isAttentionCheck: abTestState.isAttentionCheck ?? false,
                attentionCheckPassed: abTestState.isAttentionCheck ? true : undefined,
                correctIndex: abTestState.correctIndex,
                decoyCellId: abTestState.decoyCellId
            }
        } as unknown as EditorPostMessages);

        // Keep modal open to reveal names/stats; user closes manually
    };

    const handleDismissABTest = () => {
        setAbTestState({
            isActive: false,
            variants: [],
            cellId: '',
            testId: '',
            testName: '',
            isAttentionCheck: false,
            correctIndex: undefined,
            decoyCellId: undefined,
            isRecovery: false,
            recoveryMessage: undefined
        });
    };

    const updateHeaderLabel = () => {
        // Implementation for updating header label
    };

    // Enhanced message handling for A/B testing
    useMessageHandler("editorWithABTesting", (event: MessageEvent) => {
        if (quillRef.current) {
            const quill = quillRef.current;
            if (event.data.type === "providerSendsPromptedEditResponse") {
                quill.root.innerHTML = event.data.content;
            } else if (event.data.type === "providerSendsLLMCompletionResponse") {
                const completionText = event.data.content.completion;
                const completionCellId = event.data.content.cellId;

                // Validate that the completion is for the current cell
                if (completionCellId === props.currentLineId) {
                    quill.root.innerHTML = completionText;
                    props.onChange?.({ 
                        html: quill.root.innerHTML,
                        text: quill.getText(),
                        wordCount: quill.getText().trim().split(/\s+/).length
                    });
                    setUnsavedChanges(true);
                } else {
                    console.warn(
                        `LLM completion received for cell ${completionCellId} but current cell is ${props.currentLineId}. Ignoring completion.`
                    );
                }
            } else if (event.data.type === "providerSendsABTestVariants") {
                // Handle A/B test variants: show UI only if variants differ
                const {
                    variants,
                    cellId,
                    testId,
                    testName,
                    names,
                    isAttentionCheck,
                    correctIndex,
                    decoyCellId
                } = event.data.content as {
                    variants: string[];
                    cellId: string;
                    testId: string;
                    testName?: string;
                    names?: string[];
                    isAttentionCheck?: boolean;
                    correctIndex?: number;
                    decoyCellId?: string;
                };
                if (cellId === props.currentLineId && Array.isArray(variants) && variants.length > 0) {
                    const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
                    const allIdentical = variants.every((v) => norm(v) === norm(variants[0]));

                    // For attention checks, always show the selector even if variants look similar
                    // (The decoy should be different content but valid translation style)
                    if ((variants.length > 1 && !allIdentical) || isAttentionCheck) {
                        setAbTestState({
                            isActive: true,
                            variants,
                            cellId,
                            testId,
                            testName,
                            names,
                            isAttentionCheck,
                            correctIndex,
                            decoyCellId,
                            isRecovery: false
                        });
                    } else {
                        // Auto-apply first variant silently
                        quillRef.current?.root && (quillRef.current.root.innerHTML = variants[0]);
                        props.onChange?.({
                            html: variants[0],
                            text: variants[0],
                            wordCount: variants[0]?.trim()?.split(/\s+/).length || 0,
                        });
                    }
                }
            }
            updateHeaderLabel();
        }
    }, [props.currentLineId, props.onChange, updateHeaderLabel]);

    // Rest of the Editor component logic would be here...
    // For brevity, I'm including just the essential parts for A/B testing
    // The full implementation would include all the Quill setup, formatting, etc.

    useImperativeHandle(ref, () => ({
        quillRef,
        printContents: () => {
            if (quillRef.current) {
                console.log(quillRef.current.getContents());
            }
        },
        getSelection: () => {
            if (!quillRef.current) return null;
            const selection = quillRef.current.getSelection();
            if (!selection) return null;
            return {
                text: quillRef.current.getText(selection.index, selection.length),
                html: quillRef.current.getSemanticHTML(selection.index, selection.length)
            };
        },
        getCurrentLineId: () => props.currentLineId,
        setSelectionToRange: (from: number, to: number) => {
            quillRef.current?.setSelection(from, to - from);
        },
        focus: () => {
            quillRef.current?.focus();
        },
        clearSelection: () => {
            quillRef.current?.setSelection(null);
        },
        addText: (text: string) => {
            const selection = quillRef.current?.getSelection();
            if (selection && quillRef.current) {
                quillRef.current.insertText(selection.index, text);
            }
        },
        isEnabled: () => isEnabled,
        setIsEnabled,
        showHistory: () => showHistory,
        setShowHistory,
        getCleanTextFromQuill: () => {
            return quillRef.current ? getCleanedHtml(quillRef.current.getSemanticHTML()) : "";
        },
        getQuillContent: () => {
            return quillRef.current?.root.innerHTML || "";
        },
        deleteText: (from: number, to: number) => {
            quillRef.current?.deleteText(from, to - from);
        },
        insertText: (position: number, text: string) => {
            quillRef.current?.insertText(position, text);
        }
    }));

    return (
        <div className="editor-container">
            {/* Quill editor container */}
            <div 
                ref={setQuillContainer}
                className={`quill-editor ${props.fontSizeClass || ''}`}
                style={{ 
                    fontFamily: props.fontFamily,
                    direction: props.isRTL ? 'rtl' : 'ltr'
                }}
            />
            
            {/* A/B Testing Overlay */}
            {abTestState.isActive && (
                <ABTestVariantSelector
                    key={`${abTestState.testId}-${abTestState.isRecovery ? 'recovery' : 'initial'}`}
                    variants={abTestState.variants}
                    cellId={abTestState.cellId}
                    testId={abTestState.testId}
                    headerOverride={abTestState.recoveryMessage}
                    onVariantSelected={handleVariantSelected}
                    onDismiss={handleDismissABTest}
                />
            )}
        </div>
    );
});

EditorWithABTesting.displayName = 'EditorWithABTesting';

export default EditorWithABTesting;
