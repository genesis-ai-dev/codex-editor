"use client";

import React, { useState, useEffect, useRef } from "react";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "../../components/ui/accordion";
import { ProgressDots } from "./ProgressDots";
import { deriveSubsectionPercentages, getProgressDisplay } from "../utils/progressUtils";
import MicrophoneIcon from "../../components/ui/icons/MicrophoneIcon";
import {
    Languages,
    Check,
    RotateCcw,
    X,
    Undo2,
    Plus,
    Trash2,
    Replace,
} from "lucide-react";
import type { Subsection, ProgressPercentages } from "../../lib/types";
import type { MilestoneIndex, MilestoneInfo } from "../../../../../types";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

const MAX_VALIDATION_LEVELS = 15;

/** Inline hint when remove-milestone is armed (tooltip keeps the longer explanation). */
const REMOVE_MILESTONE_CONFIRM_INLINE = "Click again to confirm";
const REMOVE_MILESTONE_CONFIRM_TOOLTIP =
    "Click again within 3s to confirm — content merges into the previous milestone";

/**
 * Demote icon. Promotion reuses lucide's stock `Replace` glyph (dashed
 * square top-right, solid square bottom-left, arrow hooking down into the
 * solid square). Demotion is its visual inverse: the squares are the
 * horizontal mirror of `Replace` (dashed top-LEFT, solid bottom-RIGHT) and
 * the arrow is a bent glyph — a horizontal segment with the arrowhead
 * pointing LEFT toward the dashed square, curving into a short vertical tail
 * that drops toward the solid square. (Geometrically it is Replace's arrow
 * rotated 90° anticlockwise in place; baked to literal coordinates so no
 * wrapper transform is needed.) The bend keeps the arrow hugging the top
 * edge instead of cutting through the gap between the two squares. SVG
 * attributes mirror lucide's so `className` sizing (`h-4 w-4`) and
 * `currentColor` still apply.
 */
const DemoteMilestoneIcon = ({ className }: { className?: string; }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        {/* Dashed square, top-left (horizontal mirror of Replace's corners). */}
        <path d="M10 4c0-1.1-.9-2-2-2" />
        <path d="M4 2c-1.1 0-2 .9-2 2" />
        <path d="M2 8c0 1.1.9 2 2 2" />
        <path d="M8 10c1.1 0 2-.9 2-2" />
        {/* Bent arrow: arrowhead points left, then the shaft curves down into
            a short vertical tail above the solid square. */}
        <path d="M15.5 9.5 12.5 6.5 15.5 3.5" />
        <path d="M12.5 6.5h5c1.7 0 3 1.3 3 3v1" />
        {/* Solid square, bottom-right. */}
        <rect width="8" height="8" x="14" y="14" rx="2" />
    </svg>
);

interface MilestoneAccordionProps {
    isOpen: boolean;
    onClose: () => void;
    milestoneIndex: MilestoneIndex | null;
    currentMilestoneIndex: number;
    currentSubsectionIndex: number;
    getSubsectionsForMilestone: (milestoneIdx: number) => Subsection[];
    requestCellsForMilestone: (milestoneIdx: number, subsectionIdx?: number) => void;
    allSubsectionProgress?: Record<number, Record<number, ProgressPercentages>>;
    unsavedChanges: boolean;
    isSourceText: boolean;
    anchorRef: React.RefObject<HTMLDivElement>;
    calculateSubsectionProgress: (
        subsection: Subsection,
        subsectionIndex: number
    ) => {
        isFullyTranslated: boolean;
        isFullyValidated: boolean;
        percentTranslationsCompleted?: number;
        percentTextValidatedTranslations?: number;
        percentAudioTranslationsCompleted?: number;
        percentAudioValidatedTranslations?: number;
        textValidationLevels?: number[];
        audioValidationLevels?: number[];
        requiredTextValidations?: number;
        requiredAudioValidations?: number;
    };
    requestSubsectionProgress?: (milestoneIdx: number) => void;
    vscode: any;
    /**
     * When true, display the numeric cell range on every subdivision even if
     * the subdivision has a user-assigned name. Renaming and editing still
     * work normally — the preference only affects the visible label. Defaults
     * to false (names take precedence).
     */
    useSubdivisionNumberLabels?: boolean;
    /**
     * When true, the accordion mounts with the gear/settings affordances
     * already revealed (title pencil, per-subsection pencils always visible,
     * "Add break…" / "Reset" footer controls visible). Useful for tests and
     * for parents that want to deep-link straight into editing. Defaults to
     * `false`, matching the read-only default UX.
     */
    initialSettingsMode?: boolean;
    /**
     * Workspace opt-in for milestone-placement editing controls
     * (add/remove/promote/demote). When false the structural buttons are
     * hidden even in settings mode. Mirrors
     * `codex-editor-extension.enableMilestonePlacementEditing`.
     */
    enableMilestonePlacementEditing?: boolean;
}

export function MilestoneAccordion({
    isOpen,
    onClose,
    milestoneIndex,
    currentMilestoneIndex,
    currentSubsectionIndex,
    getSubsectionsForMilestone,
    requestCellsForMilestone,
    allSubsectionProgress,
    unsavedChanges,
    isSourceText,
    anchorRef,
    calculateSubsectionProgress,
    requestSubsectionProgress,
    vscode,
    useSubdivisionNumberLabels = false,
    initialSettingsMode = false,
    enableMilestonePlacementEditing = false,
}: MilestoneAccordionProps) {
    // Layout constants
    const DROPDOWN_MAX_HEIGHT_VIEWPORT_PERCENT = 60; // 60vh
    const DROPDOWN_MAX_HEIGHT_PIXELS = 500; // px
    const DROPDOWN_HEADER_HEIGHT = 60; // px - approximate height of header with padding
    const DROPDOWN_IDEAL_WIDTH = 400; // px
    const DROPDOWN_EDGE_PADDING = 20; // px - minimum distance from viewport edges
    const DROPDOWN_WIDTH_PADDING = 40; // px - total horizontal padding for width calculation
    const DROPDOWN_ARROW_MARGIN = 8; // px - margin for arrow positioning
    const DROPDOWN_ARROW_SPACING = 16; // px - spacing when positioning above anchor
    const DROPDOWN_VIEWPORT_HEIGHT_OFFSET = 80; // px - reserved space from viewport edges
    const DROPDOWN_BORDER_RADIUS = 6; // px
    const DROPDOWN_Z_INDEX = 9999;

    const accordionRef = useRef<HTMLDivElement>(null);
    const currentMilestoneRef = useRef<HTMLDivElement>(null);
    const currentSubsectionRef = useRef<HTMLDivElement>(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });
    const [arrowPosition, setArrowPosition] = useState<"top" | "bottom">("top");
    const [expandedMilestone, setExpandedMilestone] = useState<string | null>(
        currentMilestoneIndex.toString()
    );
    // Per-row milestone rename. The input lives inline on the milestone row
    // (parity with the subsection rename pencil), so we track WHICH milestone
    // index is in edit mode rather than a global boolean. `null` = not editing.
    const [editingMilestoneIdx, setEditingMilestoneIdx] = useState<number | null>(null);
    const [editedMilestoneValue, setEditedMilestoneValue] = useState("");
    const [originalMilestoneValue, setOriginalMilestoneValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const isEditingMilestone = editingMilestoneIdx !== null;
    // Settings mode reveals destructive / structural controls (title pencil,
    // per-subsection pencils, add-break / reset footers). Default off so the
    // accordion stays read-only on first open; the gear button toggles it.
    const [isSettingsMode, setIsSettingsMode] = useState(initialSettingsMode);
    // Local cache of edited milestone values to show changes immediately before webview refresh
    const [localMilestoneValues, setLocalMilestoneValues] = useState<Record<number, string>>({});

    // Subsection rename state. `editingSubsection` identifies the single row
    // currently in edit mode; `localSubsectionNames` is an optimistic cache so
    // saved renames render immediately without waiting for the webview refresh.
    // Keyed by `${milestoneIdx}:${subsectionKey}` so renames survive milestone
    // expansion/collapse.
    const [editingSubsection, setEditingSubsection] = useState<{
        milestoneIdx: number;
        subsectionIdx: number;
        key: string;
    } | null>(null);
    const [editedSubsectionName, setEditedSubsectionName] = useState("");
    const [originalSubsectionName, setOriginalSubsectionName] = useState("");
    const [localSubsectionNames, setLocalSubsectionNames] = useState<Record<string, string>>({});
    const subsectionInputRef = useRef<HTMLInputElement>(null);

    const getLocalSubsectionName = (
        milestoneIdx: number,
        key: string | undefined
    ): string | undefined => {
        if (!key) return undefined;
        return localSubsectionNames[`${milestoneIdx}:${key}`];
    };

    // Tracks the milestone whose "Reset breaks" button is in its confirm
    // state (the one-click→confirm pattern). Null means no reset is pending.
    const [resetConfirmMilestoneIdx, setResetConfirmMilestoneIdx] = useState<number | null>(null);
    const resetConfirmTimeoutRef = useRef<number | null>(null);

    // "Add break" form state. Only one milestone can have the form open at a
    // time; the cell-number field is a string so we can accept and validate
    // partial input (empty, non-numeric, out of range) before posting.
    const [addBreakMilestoneIdx, setAddBreakMilestoneIdx] = useState<number | null>(null);
    const [addBreakCellNumber, setAddBreakCellNumber] = useState<string>("");
    const [addBreakError, setAddBreakError] = useState<string>("");
    const addBreakInputRef = useRef<HTMLInputElement>(null);

    // "Add milestone" form state — independent from the subdivision form so
    // the user can switch between the two without the second form forgetting
    // the value they typed. Same string-typed input pattern.
    const [addMilestoneMilestoneIdx, setAddMilestoneMilestoneIdx] = useState<number | null>(null);
    const [addMilestoneCellNumber, setAddMilestoneCellNumber] = useState<string>("");
    const [addMilestoneError, setAddMilestoneError] = useState<string>("");
    const addMilestoneInputRef = useRef<HTMLInputElement>(null);

    // Two-click confirmation for the milestone trash. Demote is reversible
    // (you can promote back) so it commits on a single click; remove drops
    // the seam entirely, so it stays gated on the arm-then-confirm pattern.
    const [removeConfirmMilestoneIdx, setRemoveConfirmMilestoneIdx] = useState<number | null>(null);
    const removeConfirmTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        const resetTimer = resetConfirmTimeoutRef;
        const removeTimer = removeConfirmTimeoutRef;
        return () => {
            if (resetTimer.current !== null) {
                window.clearTimeout(resetTimer.current);
            }
            if (removeTimer.current !== null) {
                window.clearTimeout(removeTimer.current);
            }
        };
    }, []);

    // When the add-break form opens, focus the number input so keyboard-first
    // users can type immediately.
    useEffect(() => {
        if (addBreakMilestoneIdx !== null) {
            addBreakInputRef.current?.focus();
        }
    }, [addBreakMilestoneIdx]);

    useEffect(() => {
        if (addMilestoneMilestoneIdx !== null) {
            addMilestoneInputRef.current?.focus();
        }
    }, [addMilestoneMilestoneIdx]);

    /**
     * Rebuilds the milestone's placement list from its resolved subdivisions.
     * Only subdivisions at index > 0 with `source === "custom"` and a valid
     * `startCellId` correspond to actual placements; the implicit first
     * subdivision and arithmetic auto-chunks are derived, not stored.
     */
    const getCurrentPlacements = (
        milestone: MilestoneInfo | undefined
    ): { startCellId: string }[] => {
        if (!milestone?.subdivisions) return [];
        return milestone.subdivisions
            .filter((s) => s.index > 0 && s.source === "custom" && !!s.startCellId)
            .map((s) => ({ startCellId: s.startCellId as string }));
    };

    const handleDeleteSubsection = (
        e: React.MouseEvent<HTMLElement>,
        milestoneIdx: number,
        subsection: Subsection
    ) => {
        e.stopPropagation();
        if (!isSourceText) return; // Defensive: control should only render on source.
        if (!subsection.startCellId || subsection.source !== "custom") return;
        // Implicit first subdivision shares its anchor with the milestone start,
        // not an actual placement, so refuse to "delete" it.
        if (subsection.startIndex === 0) return;
        const milestone = milestoneIndex?.milestones[milestoneIdx];
        const placements = getCurrentPlacements(milestone).filter(
            (p) => p.startCellId !== subsection.startCellId
        );
        vscode.postMessage({
            command: "updateMilestoneSubdivisions",
            content: {
                milestoneIndex: milestoneIdx,
                subdivisions: placements,
            },
        });
    };

    const handleResetSubdivisionsClick = (
        e: React.MouseEvent<HTMLButtonElement>,
        milestoneIdx: number
    ) => {
        e.stopPropagation();
        if (!isSourceText) return;
        if (resetConfirmMilestoneIdx !== milestoneIdx) {
            // First click → arm the confirmation; auto-disarm after a short
            // window so the button never stays "hot" forever.
            setResetConfirmMilestoneIdx(milestoneIdx);
            if (resetConfirmTimeoutRef.current !== null) {
                window.clearTimeout(resetConfirmTimeoutRef.current);
            }
            resetConfirmTimeoutRef.current = window.setTimeout(() => {
                setResetConfirmMilestoneIdx(null);
                resetConfirmTimeoutRef.current = null;
            }, 3000);
            return;
        }
        // Second click → commit the reset and clear the armed state.
        if (resetConfirmTimeoutRef.current !== null) {
            window.clearTimeout(resetConfirmTimeoutRef.current);
            resetConfirmTimeoutRef.current = null;
        }
        setResetConfirmMilestoneIdx(null);
        vscode.postMessage({
            command: "updateMilestoneSubdivisions",
            content: {
                milestoneIndex: milestoneIdx,
                subdivisions: [],
            },
        });
    };

    /**
     * Largest valid `cellNumber` for an add-break request in the given
     * milestone. Valid range is [2, totalRootCells]; we derive the upper
     * bound from the last resolved subsection's `endIndex` (which is a root
     * index, matching `SubdivisionInfo.endRootIndex` one-to-one).
     */
    const getMaxCellNumberForMilestone = (subsections: Subsection[]): number => {
        if (!subsections.length) return 0;
        return subsections[subsections.length - 1].endIndex;
    };

    const handleOpenAddBreak = (e: React.MouseEvent<HTMLButtonElement>, milestoneIdx: number) => {
        e.stopPropagation();
        if (!isSourceText) return;
        setAddBreakMilestoneIdx(milestoneIdx);
        setAddBreakCellNumber("");
        setAddBreakError("");
    };

    const handleCancelAddBreak = (e?: React.MouseEvent<HTMLButtonElement>) => {
        e?.stopPropagation();
        setAddBreakMilestoneIdx(null);
        setAddBreakCellNumber("");
        setAddBreakError("");
    };

    const handleSubmitAddBreak = (
        e: React.MouseEvent<HTMLButtonElement> | React.FormEvent<HTMLFormElement>,
        milestoneIdx: number,
        maxCellNumber: number
    ) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isSourceText) return;
        const trimmed = addBreakCellNumber.trim();
        const parsed = Number(trimmed);
        // Allowed range mirrors the provider: splitting at cell 1 would
        // duplicate the implicit first subdivision, and we can't split
        // beyond the last cell.
        if (
            trimmed.length === 0 ||
            !Number.isFinite(parsed) ||
            !Number.isInteger(parsed) ||
            parsed < 2 ||
            parsed > maxCellNumber
        ) {
            setAddBreakError(
                maxCellNumber >= 2
                    ? `Enter a number between 2 and ${maxCellNumber}.`
                    : "This milestone is too short to split."
            );
            return;
        }
        vscode.postMessage({
            command: "addMilestoneSubdivisionAnchor",
            content: {
                milestoneIndex: milestoneIdx,
                cellNumber: parsed,
            },
        });
        handleCancelAddBreak();
    };

    const handleOpenAddMilestone = (
        e: React.MouseEvent<HTMLButtonElement>,
        milestoneIdx: number
    ) => {
        e.stopPropagation();
        if (!isSourceText) return;
        setAddMilestoneMilestoneIdx(milestoneIdx);
        setAddMilestoneCellNumber("");
        setAddMilestoneError("");
        // Close the sibling subdivision form so only one is on screen at a
        // time — keeps the layout calm and the focus path predictable.
        setAddBreakMilestoneIdx(null);
    };

    const handleCancelAddMilestone = (e?: React.MouseEvent<HTMLButtonElement>) => {
        e?.stopPropagation();
        setAddMilestoneMilestoneIdx(null);
        setAddMilestoneCellNumber("");
        setAddMilestoneError("");
    };

    const handleSubmitAddMilestone = (
        e: React.MouseEvent<HTMLButtonElement> | React.FormEvent<HTMLFormElement>,
        milestoneIdx: number,
        maxCellNumber: number
    ) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isSourceText) return;
        const trimmed = addMilestoneCellNumber.trim();
        const parsed = Number(trimmed);
        if (
            trimmed.length === 0 ||
            !Number.isFinite(parsed) ||
            !Number.isInteger(parsed) ||
            parsed < 2 ||
            parsed > maxCellNumber
        ) {
            setAddMilestoneError(
                maxCellNumber >= 2
                    ? `Enter a number between 2 and ${maxCellNumber}.`
                    : "This milestone is too short to split."
            );
            return;
        }
        vscode.postMessage({
            command: "addMilestoneAtCell",
            content: {
                milestoneIndex: milestoneIdx,
                cellNumber: parsed,
            },
        });
        handleCancelAddMilestone();
    };

    const handlePromoteSubdivision = (
        e: React.MouseEvent<HTMLElement>,
        milestoneIdx: number,
        subsection: Subsection
    ) => {
        e.stopPropagation();
        if (!isSourceText) return;
        if (!enableMilestonePlacementEditing) return;
        if (!subsection.startCellId || subsection.source !== "custom") return;
        // The implicit first subdivision shares its key with the milestone
        // start; promoting it would create an empty milestone and drop the
        // boundary anchor. Surface this defensively even though the button
        // is hidden in the UI for the first subdivision.
        if (subsection.startIndex === 0) return;
        vscode.postMessage({
            command: "promoteSubdivisionToMilestone",
            content: {
                milestoneIndex: milestoneIdx,
                subdivisionKey: subsection.startCellId,
            },
        });
    };

    /**
     * Two-click confirmation pattern shared with `handleResetSubdivisionsClick`:
     * first click arms the action with a 3-second auto-disarm window; second
     * click within the window commits.
     */
    const armOrCommit = (
        milestoneIdx: number,
        currentArmed: number | null,
        setArmed: (idx: number | null) => void,
        timeoutRef: React.MutableRefObject<number | null>,
        commit: () => void
    ): boolean => {
        if (currentArmed !== milestoneIdx) {
            setArmed(milestoneIdx);
            if (timeoutRef.current !== null) {
                window.clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = window.setTimeout(() => {
                setArmed(null);
                timeoutRef.current = null;
            }, 3000);
            return false;
        }
        if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setArmed(null);
        commit();
        return true;
    };

    const handleRemoveMilestoneClick = (
        e: React.MouseEvent<HTMLElement>,
        milestoneIdx: number
    ) => {
        e.stopPropagation();
        if (!isSourceText) return;
        if (!enableMilestonePlacementEditing) return;
        if (milestoneIdx === 0) return;
        armOrCommit(
            milestoneIdx,
            removeConfirmMilestoneIdx,
            setRemoveConfirmMilestoneIdx,
            removeConfirmTimeoutRef,
            () => {
                vscode.postMessage({
                    command: "removeMilestone",
                    content: { milestoneIndex: milestoneIdx },
                });
            }
        );
    };

    const handleDemoteMilestoneClick = (
        e: React.MouseEvent<HTMLElement>,
        milestoneIdx: number
    ) => {
        e.stopPropagation();
        if (!isSourceText) return;
        if (!enableMilestonePlacementEditing) return;
        if (milestoneIdx === 0) return;
        // Demote commits on a single click — it's reversible (promote back to
        // a milestone) and only flips an existing milestone's role to a
        // subdivision break. Pure remove keeps the two-click confirmation
        // since it drops the seam entirely.
        vscode.postMessage({
            command: "demoteMilestoneToSubdivision",
            content: { milestoneIndex: milestoneIdx },
        });
    };

    // Calculate position and dimensions
    const calculatePositionAndDimensions = () => {
        if (isOpen && anchorRef.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Determine available width
            const idealWidth = DROPDOWN_IDEAL_WIDTH;
            const availableWidth = Math.min(viewportWidth - DROPDOWN_WIDTH_PADDING, idealWidth);

            // Calculate centered position
            const left = rect.left + rect.width / 2;
            const centeredLeft = left - availableWidth / 2;

            // Avoid going off screen to the left
            const adjustedLeft = Math.max(DROPDOWN_EDGE_PADDING, centeredLeft);

            // Avoid going off screen to the right
            const rightEdge = adjustedLeft + availableWidth;
            const finalLeft =
                rightEdge > viewportWidth - DROPDOWN_EDGE_PADDING
                    ? viewportWidth - DROPDOWN_EDGE_PADDING - availableWidth
                    : adjustedLeft;

            // Determine if dropdown should appear above or below
            const spaceBelow = viewportHeight - rect.bottom;
            const spaceAbove = rect.top;
            const maxHeight = Math.min(
                DROPDOWN_MAX_HEIGHT_PIXELS,
                viewportHeight - DROPDOWN_VIEWPORT_HEIGHT_OFFSET
            );

            let topPosition;
            const arrowPos: "top" | "bottom" =
                spaceBelow >= maxHeight || spaceBelow >= spaceAbove ? "top" : "bottom";

            if (arrowPos === "top") {
                topPosition = rect.bottom + window.scrollY;
            } else {
                topPosition = rect.top + window.scrollY - maxHeight - DROPDOWN_ARROW_SPACING;
            }

            setDropdownPosition({
                top: topPosition,
                left: finalLeft,
                width: availableWidth,
            });

            setArrowPosition(arrowPos);
        }
    };

    // Calculate position and size based on the anchor element and viewport
    useEffect(() => {
        calculatePositionAndDimensions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Add resize listener to handle window size changes while dropdown is open
    useEffect(() => {
        if (isOpen) {
            const handleResize = () => {
                calculatePositionAndDimensions();
            };

            window.addEventListener("resize", handleResize);

            return () => {
                window.removeEventListener("resize", handleResize);
            };
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Auto-focus the accordion wrapper ONCE on each open transition. Splitting
    // this out from the ESC / click-outside listeners is critical: when those
    // listeners' deps (notably `onClose`, often an unstable inline arrow from
    // the parent) churn, the combined effect re-fires and steals focus from
    // any in-progress inline rename input (subdivision pencil edits especially
    // — the milestone rename input lives inside an AccordionTrigger that has
    // its own focus management so it's less affected).
    const wasOpenRef = useRef(false);
    useEffect(() => {
        if (isOpen && !wasOpenRef.current && accordionRef.current) {
            accordionRef.current.focus();
        }
        wasOpenRef.current = isOpen;
    }, [isOpen]);

    // ESC + click-outside listeners. These re-attach when `onClose` changes
    // reference (cheap), but never touch focus, so inline renames stay sticky.
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("keydown", handleKeyDown);

        const handleClickOutside = (e: MouseEvent) => {
            if (
                accordionRef.current &&
                !accordionRef.current.contains(e.target as Node) &&
                anchorRef.current &&
                !anchorRef.current.contains(e.target as Node)
            ) {
                onClose();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen, onClose, anchorRef]);

    // Sync expanded milestone state when accordion opens
    useEffect(() => {
        if (isOpen) {
            setExpandedMilestone(currentMilestoneIndex.toString());
        }
    }, [isOpen, currentMilestoneIndex]);

    // Reset editing state when accordion closes
    useEffect(() => {
        if (!isOpen) {
            setEditingMilestoneIdx(null);
            // Also collapse the gear/settings affordances so reopening the
            // accordion always starts from the read-only baseline (matches
            // initialSettingsMode default and avoids "stuck open" surprises).
            setIsSettingsMode(initialSettingsMode);
        }
        // We intentionally only re-run on `isOpen` changes; resetting on
        // initialSettingsMode flips would surprise live edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Clear local cache when milestoneIndex prop changes (after webview refresh)
    useEffect(() => {
        if (milestoneIndex && Object.keys(localMilestoneValues).length > 0) {
            // Verify if cached values match the prop values (meaning refresh happened)
            let allMatch = true;
            for (const [indexStr, cachedValue] of Object.entries(localMilestoneValues)) {
                const index = parseInt(indexStr);
                if (milestoneIndex.milestones[index]?.value !== cachedValue) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) {
                // Values match, clear cache as refresh has completed
                setLocalMilestoneValues({});
            }
        }
    }, [milestoneIndex, localMilestoneValues]);

    // Update displayed milestone value when it changes externally (e.g., after successful update)
    useEffect(() => {
        if (isOpen && !isEditingMilestone && milestoneIndex) {
            const displayedIndex =
                expandedMilestone !== null && milestoneIndex.milestones[parseInt(expandedMilestone)]
                    ? parseInt(expandedMilestone)
                    : currentMilestoneIndex;
            // Use cached value if available, otherwise use prop value
            const cachedValue = localMilestoneValues[displayedIndex];
            const milestone = milestoneIndex.milestones[displayedIndex];
            const displayValue = cachedValue || milestone?.value || "";
            if (displayValue) {
                setOriginalMilestoneValue(displayValue);
                setEditedMilestoneValue(displayValue);
            }
        }
    }, [
        expandedMilestone,
        currentMilestoneIndex,
        milestoneIndex,
        isOpen,
        isEditingMilestone,
        localMilestoneValues,
    ]);

    // Request progress when milestone is expanded (if we don't have it yet)
    useEffect(() => {
        if (isOpen && expandedMilestone !== null && requestSubsectionProgress) {
            const milestoneIdx = parseInt(expandedMilestone);
            if (!isNaN(milestoneIdx)) {
                const hasProgress = allSubsectionProgress?.[milestoneIdx] !== undefined;
                if (!hasProgress) {
                    requestSubsectionProgress(milestoneIdx);
                }
            }
        }
    }, [isOpen, expandedMilestone, allSubsectionProgress, requestSubsectionProgress]);

    // Helper function to calculate progress for a specific milestone's subsection
    const calculateSubsectionProgressForMilestone = (
        milestoneIdx: number,
        subsection: Subsection,
        subsectionIndex: number
    ) => {
        // Use progress from allSubsectionProgress if available for this milestone
        if (allSubsectionProgress?.[milestoneIdx]?.[subsectionIndex] !== undefined) {
            const backendProgress = allSubsectionProgress[milestoneIdx][subsectionIndex];
            return {
                isFullyTranslated: backendProgress.percentTranslationsCompleted === 100,
                isFullyValidated: backendProgress.percentFullyValidatedTranslations === 100,
                percentTranslationsCompleted: backendProgress.percentTranslationsCompleted,
                percentAudioTranslationsCompleted:
                    backendProgress.percentAudioTranslationsCompleted,
                percentFullyValidatedTranslations:
                    backendProgress.percentFullyValidatedTranslations,
                percentAudioValidatedTranslations:
                    backendProgress.percentAudioValidatedTranslations,
                percentTextValidatedTranslations: backendProgress.percentTextValidatedTranslations,
                textValidationLevels: backendProgress.textValidationLevels,
                audioValidationLevels: backendProgress.audioValidationLevels,
                requiredTextValidations: backendProgress.requiredTextValidations,
                requiredAudioValidations: backendProgress.requiredAudioValidations,
            };
        }

        // Fall back to calculateSubsectionProgress for current milestone
        if (milestoneIdx === currentMilestoneIndex) {
            return calculateSubsectionProgress(subsection, subsectionIndex);
        }

        // Return default values if progress is not available
        return {
            isFullyTranslated: false,
            isFullyValidated: false,
            percentTranslationsCompleted: 0,
            percentAudioTranslationsCompleted: 0,
            percentFullyValidatedTranslations: 0,
            percentAudioValidatedTranslations: 0,
            percentTextValidatedTranslations: 0,
            textValidationLevels: undefined,
            audioValidationLevels: undefined,
            requiredTextValidations: undefined,
            requiredAudioValidations: undefined,
        };
    };

    // Scroll to current subsection when accordion opens
    useEffect(() => {
        if (isOpen && accordionRef.current) {
            // Wait for accordion animation to complete before scrolling
            const timeoutId = setTimeout(() => {
                // Prefer scrolling to the subsection if available, otherwise fall back to milestone
                const targetElement = currentSubsectionRef.current || currentMilestoneRef.current;
                if (!targetElement) return;

                // Find the scrollable container (the div with overflow-y-auto)
                const scrollContainer = accordionRef.current?.querySelector(
                    '[class*="overflow-y-auto"]'
                ) as HTMLElement;

                // Get the element's position relative to the scroll container
                const elementTop = targetElement.offsetTop;

                // Calculate scroll position to show the element at the top of visible area
                // accounting for the header height.
                const scrollPosition = elementTop - DROPDOWN_HEADER_HEIGHT;

                scrollContainer.scrollTo({
                    top: Math.max(0, scrollPosition),
                    behavior: "smooth",
                });
            }, 200);

            return () => clearTimeout(timeoutId);
        }
    }, [isOpen, currentMilestoneIndex, currentSubsectionIndex]);

    if (!isOpen || !milestoneIndex) return null;

    // Get milestone progress
    const getMilestoneProgress = (milestoneIdx: number) => {
        // milestoneProgress uses 1-based keys
        const progress = milestoneIndex.milestoneProgress?.[milestoneIdx + 1];
        if (!progress) {
            return {
                textValidatedPercent: 0,
                textCompletedPercent: 0,
                audioValidatedPercent: 0,
                audioCompletedPercent: 0,
            };
        }

        return deriveSubsectionPercentages({
            percentTranslationsCompleted: progress.percentTranslationsCompleted,
            percentTextValidatedTranslations: progress.percentTextValidatedTranslations,
            percentAudioTranslationsCompleted: progress.percentAudioTranslationsCompleted,
            percentAudioValidatedTranslations: progress.percentAudioValidatedTranslations,
            isFullyTranslated: progress.percentTranslationsCompleted === 100,
            isFullyValidated: progress.percentFullyValidatedTranslations === 100,
        });
    };

    // Helper function to aggregate validation levels from all subsections for a milestone
    const getMilestoneValidationLevels = (milestoneIdx: number) => {
        const subsections = getSubsectionsForMilestone(milestoneIdx);
        const subsectionProgressData = allSubsectionProgress?.[milestoneIdx];

        if (!subsectionProgressData || subsections.length === 0) {
            return {
                textValidationLevels: undefined,
                audioValidationLevels: undefined,
                requiredTextValidations: undefined,
                requiredAudioValidations: undefined,
            };
        }

        // Collect validation level arrays from all subsections
        const textValidationLevelsArrays: number[][] = [];
        const audioValidationLevelsArrays: number[][] = [];
        let maxRequiredTextValidations = 0;
        let maxRequiredAudioValidations = 0;

        subsections.forEach((_, subsectionIdx) => {
            const progress = subsectionProgressData[subsectionIdx];
            if (progress) {
                if (progress.textValidationLevels) {
                    textValidationLevelsArrays.push(progress.textValidationLevels);
                }
                if (progress.audioValidationLevels) {
                    audioValidationLevelsArrays.push(progress.audioValidationLevels);
                }
                if (progress.requiredTextValidations) {
                    maxRequiredTextValidations = Math.max(
                        maxRequiredTextValidations,
                        progress.requiredTextValidations
                    );
                }
                if (progress.requiredAudioValidations) {
                    maxRequiredAudioValidations = Math.max(
                        maxRequiredAudioValidations,
                        progress.requiredAudioValidations
                    );
                }
            }
        });

        // Average the validation level percentages across subsections
        const averageLevels = (levelArrays: number[][]): number[] | undefined => {
            if (levelArrays.length === 0) return undefined;

            const maxLength = Math.max(...levelArrays.map((arr) => arr.length));
            if (maxLength === 0) return undefined;

            const averaged: number[] = [];
            for (let i = 0; i < maxLength; i++) {
                let sum = 0;
                let count = 0;
                levelArrays.forEach((arr) => {
                    if (i < arr.length) {
                        sum += arr[i];
                        count++;
                    }
                });
                averaged.push(count > 0 ? sum / count : 0);
            }
            return averaged;
        };

        return {
            textValidationLevels: averageLevels(textValidationLevelsArrays),
            audioValidationLevels: averageLevels(audioValidationLevelsArrays),
            requiredTextValidations:
                maxRequiredTextValidations > 0 ? maxRequiredTextValidations : undefined,
            requiredAudioValidations:
                maxRequiredAudioValidations > 0 ? maxRequiredAudioValidations : undefined,
        };
    };

    // Handle subsection click
    const handleSubsectionClick = (milestoneIdx: number, subsectionIdx: number) => {
        if (!unsavedChanges) {
            requestCellsForMilestone(milestoneIdx, subsectionIdx);
            onClose();
        }
    };

    // Get the milestone index that is currently displayed in the header
    const getDisplayedMilestoneIndex = (): number => {
        if (expandedMilestone !== null) {
            const parsed = parseInt(expandedMilestone);
            if (!isNaN(parsed) && milestoneIndex?.milestones[parsed]) {
                return parsed;
            }
        }
        return currentMilestoneIndex;
    };

    // Get the milestone that is currently displayed in the header
    const getDisplayedMilestone = (): MilestoneInfo | null => {
        const displayedIndex = getDisplayedMilestoneIndex();
        const milestone = milestoneIndex?.milestones[displayedIndex];
        if (!milestone) return null;

        // Use local cached value if available (for immediate display before webview refresh)
        if (localMilestoneValues[displayedIndex]) {
            return {
                ...milestone,
                value: localMilestoneValues[displayedIndex],
            };
        }

        return milestone;
    };

    // Get the displayed milestone value (with local cache)
    const getDisplayedMilestoneValue = (): string => {
        const displayedIndex = getDisplayedMilestoneIndex();
        if (localMilestoneValues[displayedIndex]) {
            return localMilestoneValues[displayedIndex];
        }
        const milestone = milestoneIndex?.milestones[displayedIndex];
        return milestone?.value || "";
    };

    const beginEditMilestone = (e: React.MouseEvent<HTMLElement>, milestoneIdx: number): void => {
        e.stopPropagation();
        const milestone = milestoneIndex?.milestones[milestoneIdx];
        if (!milestone) return;

        const displayValue = localMilestoneValues[milestoneIdx] || milestone.value;
        setOriginalMilestoneValue(displayValue);
        setEditedMilestoneValue(displayValue);
        setEditingMilestoneIdx(milestoneIdx);

        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 0);
    };

    const handleSaveMilestone = (e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
        e.stopPropagation();
        const targetIdx = editingMilestoneIdx;
        if (targetIdx === null) return;
        const trimmedValue = editedMilestoneValue.trim();
        const targetMilestone = milestoneIndex?.milestones[targetIdx];

        if (
            targetMilestone &&
            trimmedValue !== "" &&
            trimmedValue !== targetMilestone.value
        ) {
            if (targetIdx < 0 || targetIdx >= (milestoneIndex?.milestones.length || 0)) {
                console.error(
                    `[handleSaveMilestone] Invalid milestone index: ${targetIdx}, total milestones: ${
                        milestoneIndex?.milestones.length || 0
                    }`
                );
                return;
            }

            vscode.postMessage({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: targetIdx,
                    newValue: trimmedValue,
                },
            });

            setOriginalMilestoneValue(trimmedValue);

            setLocalMilestoneValues((prev) => ({
                ...prev,
                [targetIdx]: trimmedValue,
            }));
        }
        setEditingMilestoneIdx(null);
    };

    const handleRevertMilestone = (e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
        e.stopPropagation();
        setEditedMilestoneValue(originalMilestoneValue);
        setEditingMilestoneIdx(null);
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSaveMilestone(e);
        } else if (e.key === "Escape") {
            e.preventDefault();
            handleRevertMilestone(e);
        }
    };

    const handleSubsectionEditClick = (
        e: React.MouseEvent<HTMLElement>,
        milestoneIdx: number,
        subsectionIdx: number,
        subsection: Subsection
    ) => {
        e.stopPropagation();
        if (!subsection.key) return;
        const currentName =
            getLocalSubsectionName(milestoneIdx, subsection.key) ?? subsection.name ?? "";
        setEditingSubsection({ milestoneIdx, subsectionIdx, key: subsection.key });
        setOriginalSubsectionName(currentName);
        setEditedSubsectionName(currentName);
        setTimeout(() => {
            subsectionInputRef.current?.focus();
            subsectionInputRef.current?.select();
        }, 0);
    };

    const handleSaveSubsectionName = (
        e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>
    ) => {
        e.stopPropagation();
        if (!editingSubsection) return;
        const trimmed = editedSubsectionName.trim();
        if (trimmed !== originalSubsectionName.trim()) {
            vscode.postMessage({
                command: "updateMilestoneSubdivisionName",
                content: {
                    milestoneIndex: editingSubsection.milestoneIdx,
                    subdivisionKey: editingSubsection.key,
                    newName: trimmed,
                },
            });
            // Optimistic cache so the UI reflects the new (or cleared) name
            // before the provider refresh arrives.
            setLocalSubsectionNames((prev) => ({
                ...prev,
                [`${editingSubsection.milestoneIdx}:${editingSubsection.key}`]: trimmed,
            }));
        }
        setEditingSubsection(null);
    };

    const handleRevertSubsectionName = (
        e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>
    ) => {
        e.stopPropagation();
        setEditingSubsection(null);
    };

    const handleSubsectionInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSaveSubsectionName(e);
        } else if (e.key === "Escape") {
            e.preventDefault();
            handleRevertSubsectionName(e);
        }
    };

    // Handle milestone expansion. Rename now lives inline on each row so we no
    // longer need to follow the user's selection — the input stays anchored to
    // the milestone it was opened on.
    const handleMilestoneExpansion = (value: string | null) => {
        setExpandedMilestone(value);
    };

    return (
        <div
            ref={accordionRef}
            className="milestone-accordion-dropdown focus-visible:outline-none"
            tabIndex={-1}
            style={{
                position: "absolute",
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                width: `${dropdownPosition.width}px`,
                backgroundColor: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-widget-border)",
                borderRadius: `${DROPDOWN_BORDER_RADIUS}px`,
                boxShadow: "0 6px 16px rgba(0, 0, 0, 0.15)",
                padding: "0",
                zIndex: DROPDOWN_Z_INDEX,
                display: "flex",
                flexDirection: "column",
                maxHeight: `min(${DROPDOWN_MAX_HEIGHT_VIEWPORT_PERCENT}vh, ${DROPDOWN_MAX_HEIGHT_PIXELS}px)`,
                marginTop: arrowPosition === "top" ? `${DROPDOWN_ARROW_MARGIN}px` : "0",
                marginBottom: arrowPosition === "bottom" ? `${DROPDOWN_ARROW_MARGIN}px` : "0",
                transformOrigin: arrowPosition === "top" ? "top center" : "bottom center",
            }}
        >
            <div className="flex items-center justify-between px-4 pt-4 pb-2 mb-2 border-b border-[var(--vscode-widget-border)] flex-shrink-0">
                <h2 className="text-lg font-semibold m-0">{getDisplayedMilestoneValue()}</h2>
                <div className="flex gap-y-2">
                    <div className="flex items-center justify-center gap-x-1">
                        <VSCodeButton
                            aria-label="Toggle Milestone Settings"
                            appearance="icon"
                            title={
                                isSettingsMode
                                    ? "Close milestone settings"
                                    : "Open milestone settings"
                            }
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsSettingsMode((prev) => !prev);
                            }}
                            aria-pressed={isSettingsMode}
                        >
                            <i
                                className="codicon codicon-settings-gear"
                                style={
                                    isSettingsMode
                                        ? { color: "var(--vscode-focusBorder)" }
                                        : undefined
                                }
                            />
                        </VSCodeButton>
                    </div>
                    <VSCodeButton
                        aria-label="Close Milestone"
                        appearance="icon"
                        title="Close Milestones"
                        onClick={onClose}
                    >
                        <i className="codicon codicon-close" />
                    </VSCodeButton>
                </div>
            </div>
            <div
                className="px-4 pb-4 overflow-y-auto overflow-x-hidden flex-1 min-h-0"
                style={{
                    maxHeight: `calc(min(${DROPDOWN_MAX_HEIGHT_VIEWPORT_PERCENT}vh, ${DROPDOWN_MAX_HEIGHT_PIXELS}px) - ${DROPDOWN_HEADER_HEIGHT}px)`,
                }}
            >
                <Accordion
                    type="single"
                    collapsible
                    value={expandedMilestone ?? undefined}
                    onValueChange={handleMilestoneExpansion}
                    className="w-full"
                >
                    {milestoneIndex.milestones.map(
                        (milestone: MilestoneInfo, milestoneIdx: number) => {
                            // Use local cached value if available for immediate display
                            const displayValue =
                                localMilestoneValues[milestoneIdx] || milestone.value;
                            const subsections = getSubsectionsForMilestone(milestoneIdx);
                            const milestoneProgress = getMilestoneProgress(milestoneIdx);
                            const isCurrentMilestone = currentMilestoneIndex === milestoneIdx;

                            // Get validation level data for this milestone
                            const validationLevels = getMilestoneValidationLevels(milestoneIdx);

                            // Get progress display info using getProgressDisplay (like ProgressDots)
                            const audioDisplay = getProgressDisplay(
                                milestoneProgress.audioValidatedPercent,
                                milestoneProgress.audioCompletedPercent,
                                "Audio",
                                validationLevels.audioValidationLevels,
                                validationLevels.requiredAudioValidations
                            );
                            const textDisplay = getProgressDisplay(
                                milestoneProgress.textValidatedPercent,
                                milestoneProgress.textCompletedPercent,
                                "Text",
                                validationLevels.textValidationLevels,
                                validationLevels.requiredTextValidations
                            );

                            // Helper function to get icon style (similar to getDotStyle in ProgressDots)
                            const getIconStyle = (
                                colorClass: string,
                                completedLevels: number,
                                isTextCompleted: boolean,
                                requiredValidations?: number
                            ) => {
                                // Only apply progressive darkness when text is fully translated
                                if (isTextCompleted && colorClass === "text-charts-blue-dark") {
                                    const maxLevels = Math.min(
                                        requiredValidations || 1,
                                        MAX_VALIDATION_LEVELS
                                    );
                                    const brightnessRange = 0.55; // 0.95 to 0.4
                                    const baseBrightness = 0.95;
                                    const brightness = Math.max(
                                        0.4, // Minimum darkness (for 15 levels)
                                        baseBrightness -
                                            brightnessRange * (completedLevels / maxLevels)
                                    );

                                    return {
                                        filter: `brightness(${brightness})`,
                                    };
                                }
                                return {};
                            };

                            // Determine if text is fully translated
                            const isTextFullyTranslated =
                                milestoneProgress.textCompletedPercent >= 100;

                            const isEditingThisMilestone =
                                editingMilestoneIdx === milestoneIdx;

                            return (
                                <div
                                    key={milestoneIdx}
                                    ref={isCurrentMilestone ? currentMilestoneRef : undefined}
                                >
                                    <AccordionItem
                                        value={milestoneIdx.toString()}
                                        className="border-accent"
                                    >
                                        <AccordionTrigger
                                            className={`hover:no-underline p-2 cursor-pointer [&>svg]:hidden ${
                                                isCurrentMilestone ? "bg-accent font-semibold" : ""
                                            }`}
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex justify-between items-center gap-3 flex-1 min-w-0">
                                                    {isEditingThisMilestone ? (
                                                        <input
                                                            ref={inputRef}
                                                            type="text"
                                                            value={editedMilestoneValue}
                                                            onChange={(e) =>
                                                                setEditedMilestoneValue(
                                                                    e.target.value
                                                                )
                                                            }
                                                            onKeyDown={handleInputKeyDown}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="font-medium flex-1 mr-2 bg-transparent border border-[var(--vscode-input-border)] rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--vscode-focusBorder)]"
                                                            style={{
                                                                color: "var(--vscode-input-foreground)",
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className="font-medium truncate hover:underline milestone-navigate">
                                                            {displayValue}
                                                        </span>
                                                    )}
                                                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                                                        <div className="flex items-center gap-2">
                                                        {isEditingThisMilestone ? (
                                                            <>
                                                                <VSCodeButton
                                                                    aria-label="Save Milestone Rename"
                                                                    appearance="icon"
                                                                    title="Save Milestone Rename"
                                                                    onClick={handleSaveMilestone}
                                                                    disabled={
                                                                        !editedMilestoneValue.trim() ||
                                                                        editedMilestoneValue.trim() ===
                                                                            originalMilestoneValue
                                                                    }
                                                                >
                                                                    <Check className="h-4 w-4" />
                                                                </VSCodeButton>
                                                                <VSCodeButton
                                                                    aria-label="Cancel Milestone Rename"
                                                                    appearance="icon"
                                                                    title="Cancel Milestone Rename"
                                                                    onClick={handleRevertMilestone}
                                                                >
                                                                    <RotateCcw className="h-4 w-4" />
                                                                </VSCodeButton>
                                                            </>
                                                        ) : (
                                                            isSettingsMode && (
                                                            <>
                                                                <VSCodeButton
                                                                    aria-label="Rename Milestone"
                                                                    appearance="icon"
                                                                    title="Rename milestone"
                                                                    onClick={(e) =>
                                                                        beginEditMilestone(
                                                                            e,
                                                                            milestoneIdx
                                                                        )
                                                                    }
                                                                >
                                                                    <i className="codicon codicon-edit" />
                                                                </VSCodeButton>
                                                                {enableMilestonePlacementEditing &&
                                                                isSourceText &&
                                                                milestoneIdx > 0 ? (
                                                                    <>
                                                                        <VSCodeButton
                                                                            aria-label="Demote Milestone to Subdivision"
                                                                            appearance="icon"
                                                                            title="Convert this milestone into a subdivision break of the previous milestone"
                                                                            onClick={(e) =>
                                                                                handleDemoteMilestoneClick(
                                                                                    e,
                                                                                    milestoneIdx
                                                                                )
                                                                            }
                                                                        >
                                                                            <DemoteMilestoneIcon className="h-4 w-4" />
                                                                        </VSCodeButton>
                                                                        <VSCodeButton
                                                                            aria-label={
                                                                                removeConfirmMilestoneIdx ===
                                                                                milestoneIdx
                                                                                    ? "Confirm Remove Milestone"
                                                                                    : "Remove Milestone"
                                                                            }
                                                                            appearance="icon"
                                                                            title={
                                                                                removeConfirmMilestoneIdx ===
                                                                                milestoneIdx
                                                                                    ? REMOVE_MILESTONE_CONFIRM_TOOLTIP
                                                                                    : "Remove this milestone (content merges into the previous milestone)"
                                                                            }
                                                                            onClick={(e) =>
                                                                                handleRemoveMilestoneClick(
                                                                                    e,
                                                                                    milestoneIdx
                                                                                )
                                                                            }
                                                                            className={
                                                                                removeConfirmMilestoneIdx ===
                                                                                milestoneIdx
                                                                                    ? "bg-inputValidation-warningBackground"
                                                                                    : undefined
                                                                            }
                                                                        >
                                                                            <Trash2 className="h-4 w-4 text-[var(--vscode-errorForeground)]" />
                                                                        </VSCodeButton>
                                                                    </>
                                                                ) : (
                                                                    /* Greyed-out ghost trash — keeps the
                                                                       row spacing identical for the
                                                                       first milestone (which can never
                                                                       be removed) and when the feature
                                                                       flag is off / on a target file. */
                                                                    <VSCodeButton
                                                                        aria-hidden="true"
                                                                        appearance="icon"
                                                                        disabled
                                                                        tabIndex={-1}
                                                                        className="opacity-15 pointer-events-none"
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </VSCodeButton>
                                                                )}
                                                            </>
                                                            )
                                                        )}
                                                        <div
                                                            className={`flex items-center ${audioDisplay.colorClass}`}
                                                            style={getIconStyle(
                                                                audioDisplay.colorClass,
                                                                audioDisplay.completedValidationLevels ||
                                                                    0,
                                                                isTextFullyTranslated,
                                                                validationLevels.requiredAudioValidations
                                                            )}
                                                            title={audioDisplay.title}
                                                        >
                                                            <MicrophoneIcon
                                                                width={14}
                                                                height={14}
                                                            />
                                                        </div>
                                                        <div
                                                            className={`flex items-center ${textDisplay.colorClass}`}
                                                            style={getIconStyle(
                                                                textDisplay.colorClass,
                                                                textDisplay.completedValidationLevels ||
                                                                    0,
                                                                isTextFullyTranslated,
                                                                validationLevels.requiredTextValidations
                                                            )}
                                                            title={textDisplay.title}
                                                        >
                                                            <Languages className="h-[14px] w-[14px]" />
                                                        </div>
                                                        </div>
                                                        {removeConfirmMilestoneIdx === milestoneIdx && (
                                                            <span
                                                                className="text-xs px-2 py-1 rounded transition-colors bg-inputValidation-warningBackground text-inputValidation-warningForeground whitespace-nowrap font-normal"
                                                                aria-live="polite"
                                                            >
                                                                {REMOVE_MILESTONE_CONFIRM_INLINE}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="pb-2">
                                            <div className="space-y-1 pt-2">
                                                {subsections.map((subsection, subsectionIdx) => {
                                                    const progress =
                                                        calculateSubsectionProgressForMilestone(
                                                            milestoneIdx,
                                                            subsection,
                                                            subsectionIdx
                                                        );
                                                    const percentages =
                                                        deriveSubsectionPercentages(progress);
                                                    const isActive =
                                                        isCurrentMilestone &&
                                                        currentSubsectionIndex === subsectionIdx;
                                                    const isEditingThisRow =
                                                        editingSubsection?.milestoneIdx ===
                                                            milestoneIdx &&
                                                        editingSubsection?.subsectionIdx ===
                                                            subsectionIdx;
                                                    // Prefer the optimistic local cache, then
                                                    // provider-supplied name, so renames render
                                                    // immediately and survive webview refresh.
                                                    const cachedLocalName = getLocalSubsectionName(
                                                        milestoneIdx,
                                                        subsection.key
                                                    );
                                                    // Respect the workspace toggle: even if a name exists
                                                    // (local override or provider-resolved), we force the
                                                    // numeric range to be the visible label by dropping
                                                    // displayName. Rename UI still reflects the stored name
                                                    // so the user can edit what's actually persisted.
                                                    const displayName = useSubdivisionNumberLabels
                                                        ? undefined
                                                        : cachedLocalName ?? subsection.name;
                                                    const canRename = !!subsection.key;

                                                    return (
                                                        <div
                                                            key={subsection.id}
                                                            ref={
                                                                isActive
                                                                    ? currentSubsectionRef
                                                                    : undefined
                                                            }
                                                            onClick={() => {
                                                                if (isEditingThisRow) return;
                                                                handleSubsectionClick(
                                                                    milestoneIdx,
                                                                    subsectionIdx
                                                                );
                                                            }}
                                                            className={`group flex items-center justify-between pr-3 pl-6 py-2 rounded-md transition-colors ${
                                                                isEditingThisRow
                                                                    ? "bg-secondary"
                                                                    : isActive
                                                                    ? "bg-accent font-semibold cursor-pointer"
                                                                    : unsavedChanges
                                                                    ? "opacity-60 cursor-not-allowed"
                                                                    : "hover:bg-secondary cursor-pointer"
                                                            }`}
                                                        >
                                                            {isEditingThisRow ? (
                                                                <input
                                                                    ref={subsectionInputRef}
                                                                    type="text"
                                                                    value={editedSubsectionName}
                                                                    onChange={(e) =>
                                                                        setEditedSubsectionName(
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    onKeyDown={
                                                                        handleSubsectionInputKeyDown
                                                                    }
                                                                    onClick={(e) =>
                                                                        e.stopPropagation()
                                                                    }
                                                                    placeholder={subsection.label}
                                                                    className="flex-1 mr-2 bg-transparent border border-[var(--vscode-input-border)] rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--vscode-focusBorder)]"
                                                                    style={{
                                                                        color: "var(--vscode-input-foreground)",
                                                                    }}
                                                                />
                                                            ) : (
                                                                <span className="flex items-baseline gap-2 min-w-0 flex-1">
                                                                    <span className="truncate">
                                                                        {displayName ||
                                                                            subsection.label}
                                                                    </span>
                                                                    {displayName && (
                                                                        <span className="text-xs opacity-60 flex-shrink-0">
                                                                            {subsection.label}
                                                                        </span>
                                                                    )}
                                                                </span>
                                                            )}
                                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                                {isEditingThisRow ? (
                                                                    <>
                                                                        <VSCodeButton
                                                                            aria-label="Save Milestone Subdivision Rename"
                                                                            appearance="icon"
                                                                            title="Save Milestone Subdivision Rename"
                                                                            onClick={
                                                                                handleSaveSubsectionName
                                                                            }
                                                                        >
                                                                            <Check className="h-4 w-4" />
                                                                        </VSCodeButton>
                                                                        <VSCodeButton
                                                                            aria-label="Cancel Milestone Subdivision Rename"
                                                                            appearance="icon"
                                                                            title="Cancel Milestone Subdivision Rename"
                                                                            onClick={
                                                                                handleRevertSubsectionName
                                                                            }
                                                                        >
                                                                            <RotateCcw className="h-4 w-4" />
                                                                        </VSCodeButton>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        {/* Per-subsection edit affordances live behind the
                                                                            gear/settings toggle. When off, neither the rename
                                                                            pencil nor the remove "X" should be reachable, so we
                                                                            don't render them at all (avoids tab-stops and stale
                                                                            tooltips). When on, they're always visible — no more
                                                                            hover-only reveal. */}
                                                                        {isSettingsMode &&
                                                                            canRename && (
                                                                                <VSCodeButton
                                                                                    aria-label="Rename Milestone Subdivision"
                                                                                    appearance="icon"
                                                                                    title="Rename Milestone Subdivision"
                                                                                    onClick={(e) =>
                                                                                        handleSubsectionEditClick(
                                                                                            e,
                                                                                            milestoneIdx,
                                                                                            subsectionIdx,
                                                                                            subsection
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    <i className="codicon codicon-edit" />
                                                                                </VSCodeButton>
                                                                            )}
                                                                        {isSettingsMode &&
                                                                            enableMilestonePlacementEditing &&
                                                                            isSourceText &&
                                                                            subsection.source ===
                                                                                "custom" &&
                                                                            subsection.startCellId &&
                                                                            subsection.startIndex >
                                                                                0 && (
                                                                                <VSCodeButton
                                                                                    aria-label="Promote Subdivision to Milestone"
                                                                                    appearance="icon"
                                                                                    title="Convert this subdivision break into a full milestone"
                                                                                    onClick={(e) =>
                                                                                        handlePromoteSubdivision(
                                                                                            e,
                                                                                            milestoneIdx,
                                                                                            subsection
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    <Replace className="h-4 w-4" />
                                                                                </VSCodeButton>
                                                                            )}
                                                                        {isSettingsMode &&
                                                                            (isSourceText &&
                                                                            subsection.source ===
                                                                                "custom" &&
                                                                            subsection.startCellId &&
                                                                            subsection.startIndex >
                                                                                0 ? (
                                                                                <VSCodeButton
                                                                                    aria-label="Remove Subdivision Break"
                                                                                    appearance="icon"
                                                                                    title="Remove this break (merges with the previous subdivision)"
                                                                                    onClick={(e) =>
                                                                                        handleDeleteSubsection(
                                                                                            e,
                                                                                            milestoneIdx,
                                                                                            subsection
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    <Trash2 className="h-4 w-4 text-[var(--vscode-errorForeground)]" />
                                                                                </VSCodeButton>
                                                                            ) : (
                                                                                /* Greyed-out ghost trash can — purely decorative, but uses the
                                                                                   same button wrapper so spacing matches deletable rows. */
                                                                                <VSCodeButton
                                                                                    aria-hidden="true"
                                                                                    appearance="icon"
                                                                                    disabled
                                                                                    tabIndex={-1}
                                                                                    className="opacity-15 pointer-events-none"
                                                                                >
                                                                                    <Trash2 className="h-4 w-4" />
                                                                                </VSCodeButton>
                                                                            ))}
                                                                    </>
                                                                )}
                                                                {!isEditingThisRow && (
                                                                    <ProgressDots
                                                                        className="gap-x-[14px]"
                                                                        audio={{
                                                                            validatedPercent:
                                                                                percentages.audioValidatedPercent,
                                                                            completedPercent:
                                                                                percentages.audioCompletedPercent,
                                                                            validationLevels:
                                                                                progress.audioValidationLevels,
                                                                            requiredValidations:
                                                                                progress.requiredAudioValidations,
                                                                        }}
                                                                        text={{
                                                                            validatedPercent:
                                                                                percentages.textValidatedPercent,
                                                                            completedPercent:
                                                                                percentages.textCompletedPercent,
                                                                            validationLevels:
                                                                                progress.textValidationLevels,
                                                                            requiredValidations:
                                                                                progress.requiredTextValidations,
                                                                        }}
                                                                    />
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {isSourceText &&
                                                    isSettingsMode &&
                                                    (() => {
                                                        const maxCellNumber =
                                                            getMaxCellNumberForMilestone(
                                                                subsections
                                                            );
                                                        const canAddBreak = maxCellNumber >= 2;
                                                        const isFormOpen =
                                                            addBreakMilestoneIdx === milestoneIdx;
                                                        const isMilestoneFormOpen =
                                                            addMilestoneMilestoneIdx ===
                                                            milestoneIdx;
                                                        const canAddMilestone =
                                                            enableMilestonePlacementEditing &&
                                                            canAddBreak;
                                                        const hasCustomBreaks = subsections.some(
                                                            (s) => s.source === "custom"
                                                        );
                                                        if (
                                                            !canAddBreak &&
                                                            !canAddMilestone &&
                                                            !hasCustomBreaks
                                                        ) {
                                                            return null;
                                                        }
                                                        return (
                                                            <div className="pl-6 pr-3 pt-2 flex flex-wrap items-center gap-2">
                                                                {isFormOpen ? (
                                                                    <form
                                                                        onSubmit={(e) =>
                                                                            handleSubmitAddBreak(
                                                                                e,
                                                                                milestoneIdx,
                                                                                maxCellNumber
                                                                            )
                                                                        }
                                                                        className="flex flex-wrap items-center gap-2"
                                                                    >
                                                                        <label
                                                                            htmlFor={`add-break-input-${milestoneIdx}`}
                                                                            className="text-xs text-[var(--vscode-descriptionForeground)]"
                                                                        >
                                                                            Break at cell
                                                                        </label>
                                                                        <input
                                                                            id={`add-break-input-${milestoneIdx}`}
                                                                            ref={addBreakInputRef}
                                                                            type="text"
                                                                            inputMode="numeric"
                                                                            pattern="[0-9]*"
                                                                            value={
                                                                                addBreakCellNumber
                                                                            }
                                                                            onChange={(e) => {
                                                                                setAddBreakCellNumber(
                                                                                    e.target.value
                                                                                );
                                                                                if (addBreakError)
                                                                                    setAddBreakError(
                                                                                        ""
                                                                                    );
                                                                            }}
                                                                            onKeyDown={(e) => {
                                                                                if (
                                                                                    e.key ===
                                                                                    "Escape"
                                                                                ) {
                                                                                    e.preventDefault();
                                                                                    handleCancelAddBreak();
                                                                                }
                                                                            }}
                                                                            aria-label="Cell number for new break"
                                                                            aria-describedby={
                                                                                addBreakError
                                                                                    ? `add-break-error-${milestoneIdx}`
                                                                                    : undefined
                                                                            }
                                                                            aria-invalid={
                                                                                !!addBreakError
                                                                            }
                                                                            placeholder="322"
                                                                            className="w-20 text-xs px-2 py-1 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
                                                                        />
                                                                        <button
                                                                            type="submit"
                                                                            aria-label="Add Subdivision Break"
                                                                            title={`Add a break starting at cell ${
                                                                                addBreakCellNumber ||
                                                                                "…"
                                                                            }`}
                                                                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-button-background text-button-foreground hover:bg-button-hoverBackground transition-colors"
                                                                        >
                                                                            <Check className="h-3 w-3" />
                                                                            Add
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            aria-label="Cancel Add Break"
                                                                            onClick={(e) =>
                                                                                handleCancelAddBreak(
                                                                                    e
                                                                                )
                                                                            }
                                                                            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-secondary transition-colors"
                                                                        >
                                                                            <X className="h-3 w-3" />
                                                                            Cancel
                                                                        </button>
                                                                        {addBreakError && (
                                                                            <span
                                                                                id={`add-break-error-${milestoneIdx}`}
                                                                                role="alert"
                                                                                className="text-xs text-inputValidation-errorForeground"
                                                                            >
                                                                                {addBreakError}
                                                                            </span>
                                                                        )}
                                                                    </form>
                                                                ) : (
                                                                    canAddBreak && (
                                                                        <button
                                                                            type="button"
                                                                            aria-label="Add Subdivision Break"
                                                                            title={`Split this milestone — pick a cell between 2 and ${maxCellNumber}`}
                                                                            onClick={(e) =>
                                                                                handleOpenAddBreak(
                                                                                    e,
                                                                                    milestoneIdx
                                                                                )
                                                                            }
                                                                            className="flex items-center gap-1 text-xs pl-0 pr-2 py-1 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-secondary transition-colors"
                                                                        >
                                                                            <Plus className="h-3 w-3" />
                                                                            Add Break
                                                                        </button>
                                                                    )
                                                                )}
                                                                {/* Milestone-placement editing form / button.
                                                                    Only renders when the workspace setting is on and
                                                                    the parent has enough cells to split. Mutually
                                                                    exclusive with the subdivision form so only one
                                                                    is open at a time per milestone. */}
                                                                {isMilestoneFormOpen ? (
                                                                    <form
                                                                        onSubmit={(e) =>
                                                                            handleSubmitAddMilestone(
                                                                                e,
                                                                                milestoneIdx,
                                                                                maxCellNumber
                                                                            )
                                                                        }
                                                                        className="flex flex-wrap items-center gap-2"
                                                                    >
                                                                        <label
                                                                            htmlFor={`add-milestone-input-${milestoneIdx}`}
                                                                            className="text-xs text-[var(--vscode-descriptionForeground)]"
                                                                        >
                                                                            Milestone at cell
                                                                        </label>
                                                                        <input
                                                                            id={`add-milestone-input-${milestoneIdx}`}
                                                                            ref={
                                                                                addMilestoneInputRef
                                                                            }
                                                                            type="text"
                                                                            inputMode="numeric"
                                                                            pattern="[0-9]*"
                                                                            value={
                                                                                addMilestoneCellNumber
                                                                            }
                                                                            onChange={(e) => {
                                                                                setAddMilestoneCellNumber(
                                                                                    e.target.value
                                                                                );
                                                                                if (
                                                                                    addMilestoneError
                                                                                )
                                                                                    setAddMilestoneError(
                                                                                        ""
                                                                                    );
                                                                            }}
                                                                            onKeyDown={(e) => {
                                                                                if (
                                                                                    e.key ===
                                                                                    "Escape"
                                                                                ) {
                                                                                    e.preventDefault();
                                                                                    handleCancelAddMilestone();
                                                                                }
                                                                            }}
                                                                            aria-label="Cell number for new milestone"
                                                                            aria-describedby={
                                                                                addMilestoneError
                                                                                    ? `add-milestone-error-${milestoneIdx}`
                                                                                    : undefined
                                                                            }
                                                                            aria-invalid={
                                                                                !!addMilestoneError
                                                                            }
                                                                            placeholder="322"
                                                                            className="w-20 text-xs px-2 py-1 rounded border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
                                                                        />
                                                                        <button
                                                                            type="submit"
                                                                            aria-label="Add Milestone"
                                                                            title={`Insert a new milestone starting at cell ${
                                                                                addMilestoneCellNumber ||
                                                                                "…"
                                                                            }`}
                                                                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-button-background text-button-foreground hover:bg-button-hoverBackground transition-colors"
                                                                        >
                                                                            <Check className="h-3 w-3" />
                                                                            Add
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            aria-label="Cancel Add Milestone"
                                                                            onClick={(e) =>
                                                                                handleCancelAddMilestone(
                                                                                    e
                                                                                )
                                                                            }
                                                                            className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-secondary transition-colors"
                                                                        >
                                                                            <X className="h-3 w-3" />
                                                                            Cancel
                                                                        </button>
                                                                        {addMilestoneError && (
                                                                            <span
                                                                                id={`add-milestone-error-${milestoneIdx}`}
                                                                                role="alert"
                                                                                className="text-xs text-inputValidation-errorForeground"
                                                                            >
                                                                                {addMilestoneError}
                                                                            </span>
                                                                        )}
                                                                    </form>
                                                                ) : (
                                                                    canAddMilestone &&
                                                                    !isFormOpen && (
                                                                        <button
                                                                            type="button"
                                                                            aria-label="Add Milestone"
                                                                            title={`Insert a new milestone — pick a cell between 2 and ${maxCellNumber}`}
                                                                            onClick={(e) =>
                                                                                handleOpenAddMilestone(
                                                                                    e,
                                                                                    milestoneIdx
                                                                                )
                                                                            }
                                                                            className="flex items-center gap-1 text-xs pl-0 pr-2 py-1 rounded text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-secondary transition-colors"
                                                                        >
                                                                            <Plus className="h-3 w-3" />
                                                                            Add Milestone
                                                                        </button>
                                                                    )
                                                                )}
                                                                {hasCustomBreaks && !isFormOpen && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) =>
                                                                            handleResetSubdivisionsClick(
                                                                                e,
                                                                                milestoneIdx
                                                                            )
                                                                        }
                                                                        aria-label={
                                                                            resetConfirmMilestoneIdx ===
                                                                            milestoneIdx
                                                                                ? "Confirm Reset Subdivisions"
                                                                                : "Reset Subdivisions"
                                                                        }
                                                                        title={
                                                                            resetConfirmMilestoneIdx ===
                                                                            milestoneIdx
                                                                                ? "Click again within 3s to confirm"
                                                                                : "Remove all custom breaks in this milestone"
                                                                        }
                                                                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                                                                            resetConfirmMilestoneIdx ===
                                                                            milestoneIdx
                                                                                ? "bg-inputValidation-warningBackground text-inputValidation-warningForeground"
                                                                                : "text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-secondary"
                                                                        }`}
                                                                    >
                                                                        <Trash2 className="h-3 w-3 text-[var(--vscode-errorForeground)]" />
                                                                        {resetConfirmMilestoneIdx ===
                                                                        milestoneIdx
                                                                            ? "Click again to confirm"
                                                                            : "Reset to default breaks"}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                </div>
                            );
                        }
                    )}
                </Accordion>

                {unsavedChanges && (
                    <div className="mt-4 p-2 bg-inputValidation-warningBackground text-inputValidation-warningForeground border border-inputValidation-warningBorder rounded flex items-center gap-2 text-sm">
                        <i className="codicon codicon-warning" />
                        <span>Save changes first to change section</span>
                    </div>
                )}
            </div>
        </div>
    );
}
