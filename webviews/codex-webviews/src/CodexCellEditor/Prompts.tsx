import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { EditorPostMessages } from "../../../../types";
import "./Prompts.css";

interface Prompt {
    text: string;
    isSelected: boolean;
    isPinned?: boolean;
}

interface PromptsProps {
    cellId: string;
    cellContent: string;
    onContentUpdate: (newContent: string) => void;
}

const Prompts: React.FC<PromptsProps> = ({ cellId, cellContent, onContentUpdate }) => {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [isPromptsExpanded, setIsPromptsExpanded] = useState(false);
    const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
    const [editingPromptText, setEditingPromptText] = useState("");
    const [customPrompt, setCustomPrompt] = useState("");

    useEffect(() => {
        if (cellContent) {
            const messageContent: EditorPostMessages = {
                command: "getTopPrompts",
                content: {
                    cellId: cellId,
                    text: cellContent,
                },
            };
            window.vscodeApi.postMessage(messageContent);
        }
    }, [cellContent, cellId]);

    useEffect(() => {
        const handleTopPromptsResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsTopPrompts" && Array.isArray(message.content)) {
                setPrompts(
                    message.content.map((prompt: { prompt: string; isPinned: boolean }) => ({
                        text:
                            typeof prompt.prompt === "string"
                                ? prompt.prompt
                                : String(prompt.prompt),
                        isSelected: true,
                        isPinned: prompt.isPinned,
                    }))
                );
            }
        };

        window.addEventListener("message", handleTopPromptsResponse);
        return () => window.removeEventListener("message", handleTopPromptsResponse);
    }, []);

    const handlePromptSelect = (index: number) => {
        setPrompts((prevPrompts) =>
            prevPrompts.map((prompt, i) =>
                i === index ? { ...prompt, isSelected: !prompt.isSelected } : prompt
            )
        );
    };

    const handlePromptEdit = (index: number) => {
        setEditingPromptIndex(index);
        setEditingPromptText(prompts[index].text);
    };

    const handlePromptEditSave = () => {
        if (editingPromptIndex !== null) {
            setPrompts((prevPrompts) =>
                prevPrompts.map((prompt, i) =>
                    i === editingPromptIndex ? { ...prompt, text: editingPromptText } : prompt
                )
            );
            setEditingPromptIndex(null);
            setEditingPromptText("");
        }
    };

    const handlePromptEditCancel = () => {
        setEditingPromptIndex(null);
        setEditingPromptText("");
    };

    const handleApplyPrompts = async (selectedPrompts: string[]) => {
        for (const prompt of selectedPrompts) {
            const messageContent: EditorPostMessages = {
                command: "applyPromptedEdit",
                content: {
                    text: cellContent,
                    prompt: prompt,
                    cellId: cellId,
                },
            };
            window.vscodeApi.postMessage(messageContent);
        }
        setIsPromptsExpanded(false);
    };

    useEffect(() => {
        const handlePromptedEditResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsPromptedEditResponse") {
                onContentUpdate(message.content);
            }
        };

        window.addEventListener("message", handlePromptedEditResponse);
        return () => window.removeEventListener("message", handlePromptedEditResponse);
    }, [onContentUpdate]);

    const handleCustomPromptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setCustomPrompt(e.target.value);
    };

    const handleCustomPromptSend = () => {
        if (customPrompt.trim()) {
            const messageContent: EditorPostMessages = {
                command: "applyPromptedEdit",
                content: {
                    text: cellContent,
                    prompt: customPrompt.trim(),
                    cellId: cellId,
                },
            };
            window.vscodeApi.postMessage(messageContent);

            setPrompts((prevPrompts) => [
                { text: customPrompt.trim(), isSelected: true },
                ...prevPrompts,
            ]);

            setCustomPrompt("");
        }
    };

    const handlePinPrompt = (promptText: string) => {
        const messageContent: EditorPostMessages = {
            command: "togglePinPrompt",
            content: {
                cellId: cellId,
                promptText: promptText,
            },
        };
        window.vscodeApi.postMessage(messageContent);

        setPrompts((prevPrompts) =>
            prevPrompts.map((prompt) =>
                prompt.text === promptText ? { ...prompt, isPinned: !prompt.isPinned } : prompt
            )
        );
    };

    return (
        <div className="prompts-section">
            <PromptsHeader
                isExpanded={isPromptsExpanded}
                onToggle={() => setIsPromptsExpanded(!isPromptsExpanded)}
            />
            {isPromptsExpanded && (
                <>
                    <CustomPromptInput
                        value={customPrompt}
                        onChange={handleCustomPromptChange}
                        onSend={handleCustomPromptSend}
                    />
                    {prompts.length > 0 && (
                        <>
                            <h5>Suggested Prompts</h5>
                            <PromptsList
                                prompts={prompts}
                                editingPromptIndex={editingPromptIndex}
                                editingPromptText={editingPromptText}
                                onSelect={handlePromptSelect}
                                onEdit={handlePromptEdit}
                                onEditSave={handlePromptEditSave}
                                onEditCancel={handlePromptEditCancel}
                                setEditingPromptText={setEditingPromptText}
                                onPin={handlePinPrompt}
                            />
                            <PromptsActions
                                onApply={() =>
                                    handleApplyPrompts(
                                        prompts.filter((p) => p.isSelected).map((p) => p.text)
                                    )
                                }
                                disabled={!prompts.some((prompt) => prompt.isSelected)}
                            />
                        </>
                    )}
                </>
            )}
        </div>
    );
};

const PromptsHeader: React.FC<{ isExpanded: boolean; onToggle: () => void }> = ({
    isExpanded,
    onToggle,
}) => (
    <div className="prompts-header">
        <h4>Prompts</h4>
        <VSCodeButton appearance="icon" onClick={onToggle}>
            <i className={`codicon codicon-chevron-${isExpanded ? "up" : "down"}`}></i>
        </VSCodeButton>
    </div>
);

const PromptsList: React.FC<{
    prompts: Prompt[];
    editingPromptIndex: number | null;
    editingPromptText: string;
    onSelect: (index: number) => void;
    onEdit: (index: number) => void;
    onEditSave: () => void;
    onEditCancel: () => void;
    setEditingPromptText: (text: string) => void;
    onPin: (promptText: string) => void;
}> = ({
    prompts,
    editingPromptIndex,
    editingPromptText,
    onSelect,
    onEdit,
    onEditSave,
    onEditCancel,
    setEditingPromptText,
    onPin,
}) => (
    <ul className="prompts-list">
        {prompts.map((prompt, index) => (
            <li key={index} className="prompt-item">
                {editingPromptIndex === index ? (
                    <PromptEditForm
                        editingPromptText={editingPromptText}
                        onSave={onEditSave}
                        onCancel={onEditCancel}
                        onChange={setEditingPromptText}
                    />
                ) : (
                    <PromptDisplay
                        prompt={prompt}
                        onSelect={() => onSelect(index)}
                        onEdit={() => onEdit(index)}
                        onPin={() => onPin(prompt.text)}
                    />
                )}
            </li>
        ))}
    </ul>
);

const PromptEditForm: React.FC<{
    editingPromptText: string;
    onSave: () => void;
    onCancel: () => void;
    onChange: (text: string) => void;
}> = ({ editingPromptText, onSave, onCancel, onChange }) => (
    <div className="prompt-edit-container">
        <input
            type="text"
            value={editingPromptText}
            onChange={(e) => onChange(e.target.value)}
            className="edit-prompt-input"
        />
        <div className="prompt-edit-buttons">
            <VSCodeButton onClick={onSave}>Save</VSCodeButton>
            <VSCodeButton onClick={onCancel}>Cancel</VSCodeButton>
        </div>
    </div>
);

const PromptDisplay: React.FC<{
    prompt: Prompt;
    onSelect: () => void;
    onEdit: () => void;
    onPin: () => void;
}> = ({ prompt, onSelect, onEdit, onPin }) => (
    <div className="prompt-display-container">
        <VSCodeCheckbox checked={prompt.isSelected} onChange={onSelect} />
        <span>{prompt.text}</span>
        <VSCodeButton appearance="icon" onClick={onEdit}>
            <i className="codicon codicon-edit"></i>
        </VSCodeButton>
        <VSCodeButton
            appearance="icon"
            onClick={onPin}
            title={prompt.isPinned ? "Unpin" : "Pin"}
            className={prompt.isPinned ? "pinned" : ""}
        >
            <i className={`codicon codicon-pin ${prompt.isPinned ? "pinned" : ""}`}></i>
        </VSCodeButton>
    </div>
);

const PromptsActions: React.FC<{
    onApply: () => void;
    disabled: boolean;
}> = ({ onApply, disabled }) => (
    <div className="prompts-actions">
        <VSCodeButton onClick={onApply} disabled={disabled}>
            Apply
        </VSCodeButton>
    </div>
);

const CustomPromptInput: React.FC<{
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSend: () => void;
}> = ({ value, onChange, onSend }) => (
    <div className="custom-prompt-input">
        <input
            type="text"
            className="prompt-input"
            placeholder="Enter custom prompt"
            value={value}
            onChange={onChange}
        />
        <VSCodeButton onClick={onSend} appearance="icon" title="Send">
            <span className="codicon codicon-send" />
        </VSCodeButton>
    </div>
);

export { Prompts };
