import React from "react";
import { TranslationPair } from "../../../../types";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";

interface CellItemProps {
    item: TranslationPair;
    onUriClick: (uri: string, word: string) => void;
    isPinned: boolean;
    onPinToggle: (item: TranslationPair, isPinned: boolean) => void;
}

const stripHtmlTags = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent || "";
};

const CellItem: React.FC<CellItemProps> = ({ item, onUriClick, isPinned, onPinToggle }) => {
    const handleSourceCopy = () => navigator.clipboard.writeText(stripHtmlTags(item.sourceCell.content || ""));
    
    const handleTargetCopy = () => navigator.clipboard.writeText(stripHtmlTags(item.targetCell.content || ""));

    const getTargetUri = (uri: string): string => {
        if (!uri) return "";
        return uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
    };

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

                    <Separator />

                    <div>
                        <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                            Target Text
                        </div>
                        {item.targetCell.content ? (
                            <p
                                className="text-sm leading-relaxed mb-3"
                                dangerouslySetInnerHTML={{
                                    __html: item.targetCell.content,
                                }}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground italic mb-3">
                                No translation yet
                            </p>
                        )}
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
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default CellItem;
