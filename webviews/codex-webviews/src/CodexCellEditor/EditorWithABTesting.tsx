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
import { ABTestQueueItem } from "./abTestTypes";

const icons: any = Quill.import("ui/icons");
const vscode: any = (window as any).vscodeApi;

registerQuillSpellChecker(Quill, vscode);

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
    // A/B test queue: items accumulate during batch, shown one at a time
    const [abTestQueue, setAbTestQueue] = useState<ABTestQueueItem[]>([]);

    const currentABTest = abTestQueue.length > 0 ? abTestQueue[0] : null;

    const handleVariantSelected = (selectedIndex: number, selectionTimeMs: number) => {
        if (!currentABTest) return;

        // Send selection to backend - backend handles all logic
        vscode.postMessage({
            command: "selectABTestVariant",
            content: {
                cellId: currentABTest.cellId,
                selectedIndex,
                testId: currentABTest.testId,
                testName: currentABTest.testName,
                selectionTimeMs,
                totalVariants: currentABTest.variants?.length ?? 0,
                variants: currentABTest.variants,
                // Pass model identifiers for server-initiated model comparison tests
                ...(currentABTest.models && currentABTest.models.length > 0 ? { models: currentABTest.models } : {}),
            },
        } as EditorPostMessages);

        // Remove completed test from the front of the queue — next one shows automatically
        setAbTestQueue((prev) => prev.slice(1));
    };

    const handleDismissABTest = () => {
        // Dismiss current test without selecting (skip it)
        setAbTestQueue((prev) => prev.slice(1));
    };

    const updateHeaderLabel = () => {
        // Implementation for updating header label
    };

    // Enhanced message handling for A/B testing
    useMessageHandler(
        "editorWithABTesting",
        (event: MessageEvent) => {
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
                            wordCount: quill.getText().trim().split(/\s+/).length,
                        });
                        setUnsavedChanges(true);
                    } else {
                        console.warn(
                            `LLM completion received for cell ${completionCellId} but current cell is ${props.currentLineId}. Ignoring completion.`
                        );
                    }
                } else if (event.data.type === "providerSendsABTestVariants") {
                    // Handle A/B test variants: queue them up, show one at a time
                    const { variants, cellId, testId, testName, models } = event.data.content as {
                        variants: string[];
                        cellId: string;
                        testId: string;
                        testName?: string;
                        models?: string[];
                    };
                    if (Array.isArray(variants) && variants.length > 1) {
                        setAbTestQueue((prev) => [
                            ...prev,
                            { variants, cellId, testId, testName, models },
                        ]);
                    }
                }
                updateHeaderLabel();
            }
        },
        [props.currentLineId, props.onChange, updateHeaderLabel]
    );

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
                html: quillRef.current.getSemanticHTML(selection.index, selection.length),
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
        },
    }));

    return (
        <div className="editor-container">
            {/* Quill editor container */}
            <div
                ref={setQuillContainer}
                className={`quill-editor ${props.fontSizeClass || ""}`}
                style={{
                    fontFamily: props.fontFamily,
                    direction: props.isRTL ? "rtl" : "ltr",
                }}
            />

            {/* A/B Testing Overlay — shows first item in queue */}
            {currentABTest && (
                <ABTestVariantSelector
                    key={currentABTest.testId}
                    variants={currentABTest.variants}
                    cellId={currentABTest.cellId}
                    testId={currentABTest.testId}
                    queuePosition={1}
                    queueTotal={abTestQueue.length}
                    onVariantSelected={handleVariantSelected}
                    onDismiss={handleDismissABTest}
                />
            )}
        </div>
    );
});

EditorWithABTesting.displayName = "EditorWithABTesting";

export default EditorWithABTesting;
