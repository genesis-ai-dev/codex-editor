import React, { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "../../lib/utils";

export interface FileDropzoneProps {
    onFiles: (files: File[]) => void;
    accept?: string; // e.g. ".md,.markdown" or "text/markdown"
    multiple?: boolean;
    disabled?: boolean;
    id?: string;
    className?: string;
    label?: string;
    description?: string;
}

function filterFilesByAccept(files: File[], accept?: string): File[] {
    if (!accept) return files;
    const tokens = accept
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    if (tokens.length === 0) return files;

    const matchesToken = (file: File, token: string): boolean => {
        if (token.startsWith(".")) {
            // Extension match
            const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
            return ext === token.toLowerCase();
        }
        if (token.endsWith("/*")) {
            // Mime family, e.g. text/*
            const family = token.slice(0, -2).toLowerCase();
            return file.type.toLowerCase().startsWith(family + "/");
        }
        // Exact mime type
        return file.type.toLowerCase() === token.toLowerCase();
    };

    return files.filter((f) => tokens.some((tok) => matchesToken(f, tok)));
}

export const FileDropzone: React.FC<FileDropzoneProps> = (props) => {
    const { onFiles, accept, multiple, disabled, id, className, label, description } = props;
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const handleClick = useCallback(() => {
        if (disabled) return;
        inputRef.current?.click();
    }, [disabled]);

    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(e.target.files || []);
            const filtered = filterFilesByAccept(files, accept);
            if (filtered.length > 0) onFiles(filtered);
            // Reset input value so the same file can be re-selected
            if (inputRef.current) inputRef.current.value = "";
        },
        [accept, onFiles]
    );

    const preventAnd = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        preventAnd(e);
        if (!disabled) setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        preventAnd(e);
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        preventAnd(e);
        setIsDragging(false);
        if (disabled) return;

        const dt = e.dataTransfer;
        let files: File[] = [];
        if (dt.items && dt.items.length > 0) {
            for (let i = 0; i < dt.items.length; i++) {
                const item = dt.items[i];
                if (item.kind === "file") {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
        } else if (dt.files && dt.files.length > 0) {
            files = Array.from(dt.files);
        }

        const filtered = filterFilesByAccept(files, accept);
        if (filtered.length > 0) onFiles(filtered);
    };

    return (
        <div
            role="button"
            aria-disabled={disabled}
            onClick={handleClick}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-allow-dropzone="true"
            className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center select-none",
                "transition-colors",
                disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                isDragging ? "border-primary/60 bg-primary/5" : "border-muted-foreground/25",
                className
            )}
        >
            <input
                ref={inputRef}
                id={id}
                type="file"
                accept={accept}
                multiple={multiple}
                onChange={handleInputChange}
                disabled={disabled}
                className="hidden"
            />
            <div className="inline-flex flex-col items-center gap-2">
                <Upload className="h-12 w-12 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                    {label || "Click to select a file"}
                </span>
                {description && (
                    <span className="text-xs text-muted-foreground">{description}</span>
                )}
            </div>
        </div>
    );
};

export default FileDropzone;
