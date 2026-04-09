import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/utils";
import { Sparkles } from "lucide-react";
import { isExportCategoryVisibleForGroup } from "@sharedUtils/exportOptionsEligibility";
import { TooltipContent, TooltipProvider } from "../../components/ui/tooltip";

export interface ExportOptionsPreviewPanelProps {
    /** Export group key for the pending importer (panel only mounts when user picked an importer). */
    groupKey: string;
    className?: string;
}

type PreviewItem = {
    id: string;
    title: string;
    subtitle: string;
    /** Longer explanation shown on hover */
    hoverHelp: string;
    gate?: "usfm" | "html" | "subtitles" | "roundTrip";
};

/** Twelve export paths in display order: 2 columns × 6 rows. */
const EXPORT_PREVIEW_ITEMS: PreviewItem[] = [
    {
        id: "plaintext",
        title: "Plain text",
        subtitle: "Minimal formatting",
        hoverHelp:
            "Exports translated cell content as plain text, with little structure. Useful for review, glossaries, or feeding other tools.",
    },
    {
        id: "xliff",
        title: "XLIFF",
        subtitle: "CAT / localization",
        hoverHelp:
            "Industry-standard XLIFF for translation memory systems, QA tools, and interoperability with CAT platforms.",
    },
    {
        id: "csv-tsv",
        title: "CSV / TSV",
        subtitle: "Spreadsheet + metadata",
        hoverHelp:
            "Tab-separated or comma-separated rows with cell identifiers and content, for spreadsheets, filters, and reporting.",
    },
    {
        id: "backtranslations",
        title: "Backtranslations",
        subtitle: "Spreadsheet + backtranslations",
        hoverHelp:
            "Like CSV/TSV export but includes back-translation columns, for checking meaning and consistency.",
    },
    {
        id: "usfm",
        title: "USFM",
        subtitle: "Scripture publishing",
        gate: "usfm",
        hoverHelp:
            "Generates Unified Standard Format Markup for Bible typesetting, print, and digital scripture pipelines (Paratext-compatible workflows).",
    },
    {
        id: "usfm-fast",
        title: "USFM (no validate)",
        subtitle: "Faster export",
        gate: "usfm",
        hoverHelp:
            "Same USFM goal as the standard option, with validation relaxed so large exports finish sooner. Use especially when speed matters more than strict checks.",
    },
    {
        id: "html",
        title: "HTML",
        subtitle: "Web + navigation",
        gate: "html",
        hoverHelp:
            "Browser-friendly HTML with navigation. Good for previewing a project on the web or sharing read-only output.",
    },
    {
        id: "srt",
        title: "SubRip (SRT)",
        subtitle: "Video players",
        gate: "subtitles",
        hoverHelp:
            "Classic SRT subtitles from timed cue cells. Compatible with most video editors and players.",
    },
    {
        id: "vtt-styled",
        title: "WebVTT + styles",
        subtitle: "Formatted subtitles",
        gate: "subtitles",
        hoverHelp:
            "WebVTT with supported styling, aimed at HTML5 video and players that honor cue styling.",
    },
    {
        id: "vtt-plain",
        title: "WebVTT plain",
        subtitle: "Plain subtitles",
        gate: "subtitles",
        hoverHelp:
            "WebVTT without extra styling, broad compatibility for web and tooling that expects simple cues.",
    },
    {
        id: "roundtrip",
        title: "Round-trip",
        subtitle: "Translated original file",
        gate: "roundTrip",
        hoverHelp:
            "Rountrip Export: Injects the translations into the copy of the original file, preserving the original structure and formatting.",
    },
    {
        id: "audio",
        title: "Audio bundles",
        subtitle: "Per-cell audio + timestamps",
        hoverHelp:
            "Packages audio attachments recorded in cells, optionally with timestamps. Useful for archiving or downstream media workflows.",
    },
];

function itemAvailable(item: PreviewItem, groupKey: string): boolean {
    if (!item.gate) {
        return true;
    }
    return isExportCategoryVisibleForGroup(item.gate, groupKey);
}

function OptionTile({ item, available }: { item: PreviewItem; available: boolean }) {
    return (
        <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>
                <div
                    tabIndex={0}
                    className={cn(
                        "rounded-xl border px-3 py-3 min-h-[4.75rem] flex flex-col justify-center text-center transition-colors cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        available
                            ? "border-emerald-500/50 bg-emerald-500/12 dark:bg-emerald-500/18 dark:border-emerald-400/45 shadow-sm text-foreground"
                            : "border-muted/70 bg-muted/25 text-muted-foreground opacity-80"
                    )}
                >
                    <p
                        className={cn(
                            "text-sm font-semibold leading-snug",
                            available ? "text-foreground" : "text-muted-foreground"
                        )}
                    >
                        {item.title}
                    </p>
                    <p
                        className={cn(
                            "text-xs leading-snug mt-1",
                            available ? "text-muted-foreground" : "text-muted-foreground/90"
                        )}
                    >
                        {item.subtitle}
                    </p>
                </div>
            </TooltipPrimitive.Trigger>
            <TooltipContent
                side="top"
                sideOffset={6}
                showArrow={false}
                className={cn(
                    "pointer-events-none max-w-[min(280px,85vw)] px-3 py-2 text-xs font-normal leading-relaxed text-left text-balance",
                    "bg-card text-card-foreground border border-border shadow-md"
                )}
            >
                {item.hoverHelp}
            </TooltipContent>
        </TooltipPrimitive.Root>
    );
}

export const ExportOptionsPreviewPanel: React.FC<ExportOptionsPreviewPanelProps> = ({
    groupKey,
    className,
}) => {
    return (
        <div className={cn("space-y-4 flex flex-col items-center", className)}>
            <div className="flex items-center justify-center gap-3">
                <Sparkles
                    className={cn("h-6 w-6 shrink-0", "text-emerald-600 dark:text-emerald-400")}
                />
                <h3 className="text-lg font-semibold tracking-tight">Export Options</h3>
            </div>

            <TooltipProvider delayDuration={350}>
                <div className="grid grid-cols-2 gap-3 w-full max-w-xl mx-auto">
                    {EXPORT_PREVIEW_ITEMS.map((item) => (
                        <OptionTile
                            key={item.id}
                            item={item}
                            available={itemAvailable(item, groupKey)}
                        />
                    ))}
                </div>
            </TooltipProvider>
        </div>
    );
};
