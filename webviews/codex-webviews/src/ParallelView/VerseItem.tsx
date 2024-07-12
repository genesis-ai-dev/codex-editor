import React, { useState } from 'react';
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { Item } from './types';
import { diffChars } from 'diff';

interface VerseItemProps {
    item: Item;
    index: number;
    onUriClick: (uri: string, word: string) => void;
    onSaveClick: (index: number, before: string, after: string, uri: string) => void;
    setBefore: React.Dispatch<React.SetStateAction<string>>;
    setAfter: React.Dispatch<React.SetStateAction<string>>;
    searchBoth: (query: string) => void;
    setSmartEditingIndex: React.Dispatch<React.SetStateAction<number>>;
    smartEditingIndex: number;
    getEdit: (query: string, setSmartEditText: React.Dispatch<React.SetStateAction<string>>) => Promise<any>;
}

const VerseItem: React.FC<VerseItemProps> = ({ item, index, onUriClick, onSaveClick, setBefore, setAfter, searchBoth, setSmartEditingIndex,smartEditingIndex, getEdit }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedText, setEditedText] = useState(item.codexText || '');
    const [smartEditText, setSmartEditText] = useState<string>("");
    const EnableSmartEdit = true;

    React.useEffect(() => {
        if (!item.codexText && smartEditingIndex === index) {
            setSmartEditingIndex(smartEditingIndex + 1);
        }
        if (item.codexText && smartEditingIndex === index && EnableSmartEdit) {
            
            const fetchSmartEdit = async () => {
                if (index == smartEditingIndex){
                    await getEdit(item.codexText || '', setSmartEditText);
                }
            };
            fetchSmartEdit();
        
        }
    }, [smartEditingIndex]);

    const handleEditClick = () => {
        setIsEditing(true);
        setEditedText(item.codexText || '');
    };

    const handleSaveClick = () => {
        onSaveClick(index, item.codexText || '', editedText, item.codexUri || '');
        setIsEditing(false);
    };
    const beginSmartEdit = () => {
        setBefore(item.codexText || '');
        setAfter(editedText);
        setSmartEditingIndex(1); // the current item will become 0
        searchBoth(item.codexText ||'');
        handleSaveClick();
    }
    
    const acceptSmartEdit = () => {
        if (!isEditing){
            setEditedText(smartEditText);
        }
        setSmartEditingIndex(smartEditingIndex + 1);
        handleSaveClick();
    };
    const ignoreSmartEdit = () => {
        setSmartEditingIndex(smartEditingIndex + 1);
    };
    const modifySmartEdit = () => {
        setEditedText(smartEditText);
        setIsEditing(true);
    };

    return (
        <div className="verse-item">
            <div className="verse-header">
                <span>{item.ref}</span>
                {item.codexText && (
                    <div>
                    {smartEditingIndex === index ? (
                        <div>
                         <VSCodeButton onClick={acceptSmartEdit}>
                            Accept
                         </VSCodeButton>
                         <VSCodeButton onClick={ignoreSmartEdit}>
                            Ignore
                         </VSCodeButton>
                         <VSCodeButton onClick={modifySmartEdit}>
                            Modify
                         </VSCodeButton>
                         </div>
                    ) :
                    
                    <VSCodeButton onClick={isEditing ? handleSaveClick : handleEditClick}>
                    {isEditing ? "Save" : "Edit"}
                    </VSCodeButton>
                    
                    }
                    
                    {smartEditingIndex === -1 && isEditing && EnableSmartEdit &&(
                        <VSCodeButton onClick={beginSmartEdit}>
                            Begin Smart Edit
                        </VSCodeButton>
                    )}
                    </div>
                )}
            </div>
            {item.text && (
                <div className="verse-text">
                    <span className="verse-label">Source</span>
                    <p
                        style={{ cursor: "pointer" }}
                        onClick={() => onUriClick(item.uri, `${item.ref}`)}
                    >
                        {item.text}
                    </p>
                </div>
            )}
            {item.codexText && (
                <div className="verse-text">
                    <span className="verse-label">Target</span>
                    {isEditing ? (
                        <textarea
                            id={`${index}text`}
                            value={editedText}
                            onChange={(e) => setEditedText(e.target.value)}
                            className="verse-textarea"
                        />
                    ) : (
                        <p
                            style={{ cursor: "pointer" }}
                            onClick={() => onUriClick(item.codexUri || "", `${item.ref}`)}
                        >
                            {item.codexText}
                        </p>
                    )}
                    
                    {smartEditingIndex === index && (
                        <div className="verse-text" style={{ backgroundColor: '#a0a0a0' }}>
                            <span className="verse-label">Suggested Edit</span>
                            {smartEditText == "loading..." ? (
                                <p>loading...</p>
                            ) : (
                                <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                                    {diffChars(item.codexText || '', smartEditText).map((part, i) => (
                                        <span key={i} style={{ color: part.added ? 'green' : part.removed ? 'red' : 'inherit' }}>
                                            {part.value}
                                        </span>
                                    ))}
                                </pre>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default VerseItem;