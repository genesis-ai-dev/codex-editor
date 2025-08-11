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

const icons: any = Quill.import("ui/icons");
const vscode: any = (window as any).vscodeApi;

registerQuillSpellChecker(Quill, vscode);

interface ABTestState {
    isActive: boolean;
    variants: string[];
    cellId: string;
    testId: string;
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
        testId: ''
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
                selectionTimeMs,
                totalVariants: abTestState.variants?.length ?? 0
            }
        } as EditorPostMessages);

        // Close A/B test UI
        setAbTestState({
            isActive: false,
            variants: [],
            cellId: '',
            testId: ''
        });
    };

    const handleDismissABTest = () => {
        setAbTestState({
            isActive: false,
            variants: [],
            cellId: '',
            testId: ''
        });
    };

    // Enhanced message handling for A/B testing
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
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
                    // Handle A/B test variants: show UI if 2+ variants exist, even if identical
                    const { variants, cellId, testId } = event.data.content;
                    if (cellId === props.currentLineId && Array.isArray(variants) && variants.length > 1) {
                        handleShowABTestVariants({ variants, cellId, testId });
                    }
                }
                updateHeaderLabel();
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [props.currentLineId, props.onChange]);

    // Rest of the Editor component logic would be here...
    // For brevity, I'm including just the essential parts for A/B testing
    // The full implementation would include all the Quill setup, formatting, etc.

    const updateHeaderLabel = () => {
        // Implementation for updating header label
    };

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
                    variants={abTestState.variants}
                    cellId={abTestState.cellId}
                    testId={abTestState.testId}
                    onVariantSelected={handleVariantSelected}
                    onDismiss={handleDismissABTest}
                />
            )}
        </div>
    );
});

EditorWithABTesting.displayName = 'EditorWithABTesting';

export default EditorWithABTesting;
