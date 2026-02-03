import React, { useMemo, useState, useEffect } from "react";
import { TranslationPair } from "../../../../types";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import { diffWords } from "diff";
import { stripHtml, escapeRegex, escapeHtml, canReplaceInHtml } from "./utils";

interface CellItemProps {
    item: TranslationPair;
    onUriClick: (uri: string, word: string) => void;
    isPinned: boolean;
    onPinToggle: (item: TranslationPair, isPinned: boolean) => void;
    searchQuery?: string;
    replaceText?: string;
    retainValidations?: boolean;
    onReplace?: (cellId: string, currentContent: string, retainValidations: boolean) => void;
}

const stripHtmlTags = (html: string) => {
    return stripHtml(html);
};

const highlightSearchMatches = (htmlText: string, query: string): string => {
    if (!query.trim()) return htmlText;

    // Work with the HTML directly - only highlight text nodes, not tags
    let result = htmlText;
    const matches: Array<{ start: number; end: number }> = [];

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
        result =
            result.substring(0, start) +
            `<mark style="background-color: rgba(34, 197, 94, 0.3);">${matchedText}</mark>` +
            result.substring(end);
    }

    return result;
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
                return escaped.replace(
                    queryRegex,
                    '<mark style="background-color: rgba(239, 68, 68, 0.3);">$1</mark>'
                );
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
    retainValidations = false,
    onReplace,
}) => {
    const [replaceSuccess, setReplaceSuccess] = useState(false);
    const [localRetainValidations, setLocalRetainValidations] =
        useState<boolean>(retainValidations);

    useEffect(() => {
        if (replaceSuccess) {
            const timer = setTimeout(() => setReplaceSuccess(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [replaceSuccess]);

    // Sync localRetainValidations with prop when it changes
    useEffect(() => {
        setLocalRetainValidations(retainValidations);
    }, [retainValidations]);

    const handleSourceCopy = () =>
        navigator.clipboard.writeText(stripHtmlTags(item.sourceCell.content || ""));

    const handleTargetCopy = () =>
        navigator.clipboard.writeText(stripHtmlTags(item.targetCell.content || ""));

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
            const replacedText = cleanTarget.replace(
                new RegExp(escapeRegex(searchQuery), "gi"),
                replaceText
            );
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

    const canReplace = useMemo(() => {
        if (!searchQuery.trim() || !item.targetCell.content || !replaceText) return false;
        return canReplaceInHtml(item.targetCell.content, searchQuery);
    }, [item.targetCell.content, searchQuery, replaceText]);

    return (
        <Card className={`p-4 ${isPinned ? "border-blue-500" : ""}`}>
            <CardContent className="p-0">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                            <h3 className="text-lg font-semibold">
                                {item.cellLabel ?? `[NO LABEL: ${item.cellId}]`}
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
                        <span
                            className={`codicon codicon-${isPinned ? "pinned" : "pin"}`}
                            style={{ fontSize: "14px" }}
                        ></span>
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
                                    <div className="flex items-center gap-2">
                                        {!canReplace && (
                                            <Badge
                                                variant="outline"
                                                className="text-xs text-orange-600"
                                                title="HTML interrupts this match - replacement unavailable"
                                            >
                                                HTML Interrupts
                                            </Badge>
                                        )}
                                        <Badge variant="outline" className="text-xs">
                                            Match
                                        </Badge>
                                    </div>
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
                                {hasMatch &&
                                    replaceText &&
                                    onReplace &&
                                    (canReplace ? (
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center space-x-1">
                                                <input
                                                    type="checkbox"
                                                    id={`retain-validations-${item.cellId}`}
                                                    checked={localRetainValidations}
                                                    onChange={(e) =>
                                                        setLocalRetainValidations(e.target.checked)
                                                    }
                                                    className="h-3.5 w-3.5 rounded border border-input text-primary"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                <label
                                                    htmlFor={`retain-validations-${item.cellId}`}
                                                    className="text-xs text-muted-foreground cursor-pointer"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    Retain my validation
                                                </label>
                                            </div>
                                            <Button
                                                variant="default"
                                                size="sm"
                                                onClick={() => {
                                                    onReplace(
                                                        item.cellId,
                                                        item.targetCell.content || "",
                                                        localRetainValidations
                                                    );
                                                    setReplaceSuccess(true);
                                                }}
                                                aria-label="Replace this match"
                                                disabled={replaceSuccess}
                                            >
                                                {replaceSuccess ? (
                                                    <>
                                                        <span className="codicon codicon-check mr-2"></span>
                                                        Replaced
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="codicon codicon-replace mr-2"></span>
                                                        Replace
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled
                                            title="HTML interrupts this match - replacement unavailable"
                                            aria-label="Replacement unavailable - HTML interrupts match"
                                        >
                                            <span className="codicon codicon-info mr-2"></span>
                                            Can't Replace
                                        </Button>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default CellItem;
