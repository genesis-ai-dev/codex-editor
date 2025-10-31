import React, { useMemo } from "react";
import { TranslationPair } from "../../../../types";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { diffWords } from "diff";

interface CellItemProps {
    item: TranslationPair;
    onUriClick: (uri: string, word: string) => void;
    isPinned: boolean;
    onPinToggle: (item: TranslationPair, isPinned: boolean) => void;
    searchQuery?: string;
    replaceText?: string;
    onReplace?: (cellId: string, currentContent: string) => void;
}

const stripHtmlTags = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent || "";
};

const stripHtml = (text: string): string => {
    let strippedText = text.replace(/<[^>]*>/g, "");
    strippedText = strippedText.replace(/&nbsp; ?/g, " ");
    strippedText = strippedText.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#34;/g, "");
    strippedText = strippedText.replace(/&#\d+;/g, "");
    strippedText = strippedText.replace(/&[a-zA-Z]+;/g, "");
    return strippedText;
};

const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
};

const highlightSearchMatches = (htmlText: string, query: string): string => {
    if (!query.trim()) return htmlText;
    
    // Work with the HTML directly - only highlight text nodes, not tags
    let result = htmlText;
    const matches: Array<{ start: number; end: number; }> = [];
    
    const escapedQuery = escapeRegex(query);
    const regex = new RegExp(escapedQuery, "gi");
    let match;
    
    while ((match = regex.exec(htmlText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        
        // Check if we're inside an HTML tag
        const lastTagOpen = htmlText.lastIndexOf("<", start);
        const lastTagClose = htmlText.lastIndexOf(">", start);
        const isInTag = lastTagOpen > lastTagClose;
        
        if (!isInTag) {
            matches.push({ start, end });
        }
    }
    
    // Apply highlights in reverse order to preserve positions
    for (let i = matches.length - 1; i >= 0; i--) {
        const { start, end } = matches[i];
        const matchedText = result.substring(start, end);
        result = result.substring(0, start) + 
                 `<mark style="background-color: rgba(34, 197, 94, 0.3);">${matchedText}</mark>` + 
                 result.substring(end);
    }
    
    return result;
};

const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const computeDiffHtml = (oldText: string, newText: string, searchQuery: string): string => {
    const cleanOld = stripHtml(oldText);
    const cleanNew = stripHtml(newText);
    
    const diff = diffWords(cleanOld, cleanNew);
    return diff
        .map((part) => {
            const escaped = escapeHtml(part.value);
            if (part.added) {
                return `<span style="background-color: rgba(34, 197, 94, 0.4);">${escaped}</span>`;
            }
            if (part.removed) {
                return `<span style="background-color: rgba(239, 68, 68, 0.3); text-decoration: line-through;">${escaped}</span>`;
            }
            if (searchQuery && part.value.toLowerCase().includes(searchQuery.toLowerCase())) {
                const queryRegex = new RegExp(`(${escapeRegex(searchQuery)})`, "gi");
                return escaped.replace(queryRegex, '<mark style="background-color: rgba(239, 68, 68, 0.3);">$1</mark>');
            }
            return escaped;
        })
        .join("");
};

const CellItem: React.FC<CellItemProps> = ({ 
    item, 
    onUriClick, 
    isPinned, 
    onPinToggle, 
    searchQuery = "", 
    replaceText = "",
    onReplace 
}) => {
    const handleSourceCopy = () => navigator.clipboard.writeText(stripHtmlTags(item.sourceCell.content || ""));
    
    const handleTargetCopy = () => navigator.clipboard.writeText(stripHtmlTags(item.targetCell.content || ""));

    const getTargetUri = (uri: string): string => {
        if (!uri) return "";
        return uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
    };

    const hasSourceContent = useMemo(() => {
        const content = item.sourceCell.content || "";
        const cleanContent = stripHtml(content).trim();
        return cleanContent.length > 0;
    }, [item.sourceCell.content]);

    const hasTargetContent = useMemo(() => {
        const content = item.targetCell.content || "";
        const cleanContent = stripHtml(content).trim();
        return cleanContent.length > 0;
    }, [item.targetCell.content]);

    const targetContentDisplay = useMemo(() => {
        const targetContent = item.targetCell.content || "";
        if (!targetContent) return null;

        if (replaceText && searchQuery) {
            const cleanTarget = stripHtml(targetContent);
            const replacedText = cleanTarget.replace(new RegExp(escapeRegex(searchQuery), "gi"), replaceText);
            return computeDiffHtml(targetContent, replacedText, searchQuery);
        } else if (searchQuery) {
            return highlightSearchMatches(targetContent, searchQuery);
        }
        
        return targetContent;
    }, [item.targetCell.content, searchQuery, replaceText]);

    const hasMatch = useMemo(() => {
        if (!searchQuery.trim() || !item.targetCell.content) return false;
        const cleanTarget = stripHtml(item.targetCell.content);
        return cleanTarget.toLowerCase().includes(searchQuery.toLowerCase());
    }, [item.targetCell.content, searchQuery]);

    return (
        <Card className={`p-4 ${isPinned ? "border-blue-500" : ""}`}>
            <CardContent className="p-0">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                            <h3 className="text-lg font-semibold">
                                {item.cellId}
                            </h3>
                            {isPinned && (
                                <Badge variant="secondary" className="text-blue-600">
                                    Pinned
                                </Badge>
                            )}
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        aria-label={isPinned ? "Unpin" : "Pin"}
                        onClick={() => onPinToggle(item, !isPinned)}
                    >
                        <span className={`codicon codicon-${isPinned ? "pinned" : "pin"}`} style={{ fontSize: '14px' }}></span>
                    </Button>
                </div>

                <div className="space-y-4">
                    {hasSourceContent && (
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                                Source Text
                            </div>
                            <p className="text-sm leading-relaxed mb-3">
                                {item.sourceCell.content}
                            </p>
                            <div className="flex gap-2 mt-3">
                                <Button 
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleSourceCopy}
                                    aria-label="Copy text"
                                >
                                    <span className="codicon codicon-copy mr-2"></span>
                                    Copy
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() =>
                                        onUriClick(item.sourceCell.uri || "", `${item.cellId}`)
                                    }
                                    aria-label="Open source text"
                                >
                                    <span className="codicon codicon-open-preview mr-2"></span>
                                    Open
                                </Button>
                            </div>
                        </div>
                    )}

                    {hasSourceContent && hasTargetContent && <Separator />}

                    {hasTargetContent && (
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                    Target Text
                                </div>
                                {hasMatch && replaceText && (
                                    <Badge variant="outline" className="text-xs">
                                        Match
                                    </Badge>
                                )}
                            </div>
                            <p
                                className="text-sm leading-relaxed mb-3"
                                dangerouslySetInnerHTML={{
                                    __html: targetContentDisplay || item.targetCell.content || "",
                                }}
                            />
                            <div className="flex gap-2 mt-3">
                                <Button 
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleTargetCopy}
                                    aria-label="Copy text"
                                >
                                    <span className="codicon codicon-copy mr-2"></span>
                                    Copy
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() =>
                                        onUriClick(
                                            getTargetUri(item.targetCell.uri || ""),
                                            `${item.cellId}`
                                        )
                                    }
                                    aria-label="Open target text"
                                >
                                    <span className="codicon codicon-open-preview mr-2"></span>
                                    Open
                                </Button>
                                {hasMatch && replaceText && onReplace && (
                                    <Button
                                        variant="default"
                                        size="sm"
                                        onClick={() => onReplace(item.cellId, item.targetCell.content || "")}
                                        aria-label="Replace this match"
                                    >
                                        <span className="codicon codicon-replace mr-2"></span>
                                        Replace
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default CellItem;
