import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { EditorPostMessages } from "../../../../types";

interface Prompt {
    text: string;
    isSelected: boolean;
}

interface PromptsProps {
    cellId: string;
    cellContent: string;
    onApplyPrompts: (prompts: string[]) => void;
}

const Prompts: React.FC<PromptsProps> = ({ cellId, cellContent, onApplyPrompts }) => {
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [isPromptsExpanded, setIsPromptsExpanded] = useState(false);
    const [editingPromptIndex, setEditingPromptIndex] = useState<number | null>(null);
    const [editingPromptText, setEditingPromptText] = useState("");

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
                const uniquePrompts = Array.from(new Set(message.content));
                setPrompts(
                    uniquePrompts.map((prompt) => ({
                        text: typeof prompt === "string" ? prompt : String(prompt),
                        isSelected: true,
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

    const handleApplySelectedPrompts = () => {
        const selectedPrompts = prompts
            .filter((prompt) => prompt.isSelected)
            .map((prompt) => prompt.text);
        onApplyPrompts(selectedPrompts);
    };

    return (
        <div className="top-prompts-section">
            <PromptsHeader
                isExpanded={isPromptsExpanded}
                onToggle={() => setIsPromptsExpanded(!isPromptsExpanded)}
            />
            {isPromptsExpanded && (
                <>
                    <PromptsList
                        prompts={prompts}
                        editingPromptIndex={editingPromptIndex}
                        editingPromptText={editingPromptText}
                        onSelect={handlePromptSelect}
                        onEdit={handlePromptEdit}
                        onEditSave={handlePromptEditSave}
                        onEditCancel={handlePromptEditCancel}
                        setEditingPromptText={setEditingPromptText}
                    />
                    <PromptsActions
                        onApply={handleApplySelectedPrompts}
                        disabled={!prompts.some((prompt) => prompt.isSelected)}
                    />
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
        <h4>Suggested Prompts</h4>
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
}> = ({
    prompts,
    editingPromptIndex,
    editingPromptText,
    onSelect,
    onEdit,
    onEditSave,
    onEditCancel,
    setEditingPromptText,
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
}> = ({ prompt, onSelect, onEdit }) => (
    <div className="prompt-display-container">
        <VSCodeCheckbox checked={prompt.isSelected} onChange={onSelect} />
        <span>{prompt.text}</span>
        <VSCodeButton appearance="icon" onClick={onEdit}>
            <i className="codicon codicon-edit"></i>
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

export { Prompts };
