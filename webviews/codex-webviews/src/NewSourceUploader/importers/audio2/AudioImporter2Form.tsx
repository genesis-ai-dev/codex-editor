import React, { useState, useCallback, useEffect, useRef } from "react";
import { ImporterComponentProps, SelectAudioFileMessage, ReprocessAudioFileMessage, FinalizeAudioImportMessage, AudioFileSelectedMessage, AudioFilesSelectedMessage, AudioImportProgressMessage, AudioImportCompleteMessage, UpdateAudioSegmentsMessage, AudioSegmentsUpdatedMessage } from "../../types/plugin";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Progress } from "../../../components/ui/progress";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Upload, Music, Play, Pause, ArrowLeft, Check, AlertTriangle, Settings, ChevronDown, ChevronRight, Trash2, Plus } from "lucide-react";
import { Slider } from "../../../components/ui/slider";
import { NotebookPair, ProcessedCell } from "../../types/common";
import { createProcessedCell, addMilestoneCellsToNotebookPair } from "../../utils/workflowHelpers";
import { CodexCellTypes } from "types/enums";

const vscode: { postMessage: (message: any) => void } = (window as any).vscodeApi;

interface Segment {
    id: string;
    startSec: number;
    endSec: number;
    audioUri?: string;
    isPlaying?: boolean;
}

interface AudioFileData {
    sessionId: string;
    fileName: string;
    durationSec: number;
    segments: Segment[];
    waveformPeaks: number[];
    fullAudioUri?: string;
    thresholdDb?: number;
    minDuration?: number;
}

function formatETA(seconds?: number): string {
    if (seconds === undefined || !isFinite(seconds) || seconds < 0) return "--";
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.ceil(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
}

function formatSeconds(sec: number): string {
    if (!isFinite(sec)) return "--:--";
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDuration(sec: number): string {
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = Math.floor(sec % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Automatically split any segments that exceed 30 seconds
function ensureMaxSegmentLength(segments: Segment[], sessionId: string): Segment[] {
    const MAX_SEGMENT_LENGTH = 30;
    const result: Segment[] = [];
    
    for (const seg of segments) {
        const duration = seg.endSec - seg.startSec;
        if (duration <= MAX_SEGMENT_LENGTH) {
            result.push(seg);
        } else {
            // Split into multiple segments of max 30 seconds each
            let currentStart = seg.startSec;
            let segmentIndex = 0;
            while (currentStart < seg.endSec) {
                const currentEnd = Math.min(currentStart + MAX_SEGMENT_LENGTH, seg.endSec);
                const newId = segmentIndex === 0 ? seg.id : `${sessionId}-seg${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                result.push({
                    ...seg,
                    id: newId,
                    startSec: currentStart,
                    endSec: currentEnd,
                });
                currentStart = currentEnd;
                segmentIndex++;
            }
        }
    }
    
    return result;
}

export const AudioImporterForm: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
    wizardContext,
}) => {
    const [documentName, setDocumentName] = useState<string>(
        wizardContext?.selectedSource?.name || "AudioDocument"
    );
    const [audioFile, setAudioFile] = useState<AudioFileData | null>(null);
    const [audioFiles, setAudioFiles] = useState<AudioFileData[]>([]);
    const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState<{ stage: string; message: string; progress?: number; currentSegment?: number; totalSegments?: number; etaSeconds?: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    
    // VAD settings
    const [thresholdDb, setThresholdDb] = useState(-40);
    const [minDuration, setMinDuration] = useState(0.5);
    const [showVADSettings, setShowVADSettings] = useState(false);
    const [appliedThresholdDb, setAppliedThresholdDb] = useState(-40);
    const [appliedMinDuration, setAppliedMinDuration] = useState(0.5);
    
    // Track newly added breakpoints for purple highlighting
    const [newBreakpointIndex, setNewBreakpointIndex] = useState<number | null>(null);
    const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
    const [audioElements, setAudioElements] = useState<Map<string, HTMLAudioElement>>(new Map());
    const [pendingNotebookPairs, setPendingNotebookPairs] = useState<NotebookPair[]>([]);
    const [completedImportSessions, setCompletedImportSessions] = useState<Set<string>>(new Set());
    const [allSegmentMappings, setAllSegmentMappings] = useState<Array<{ sessionId: string; mappings: Array<{ segmentId: string; cellId: string; attachmentId: string; fileName: string }> }>>([]);
    
    // Dragging state
    const [isDragging, setIsDragging] = useState(false);
    const [draggedBoundaryIndex, setDraggedBoundaryIndex] = useState<number | null>(null);
    const [dragStartX, setDragStartX] = useState(0);
    const [dragStartTime, setDragStartTime] = useState(0);
    const [hoveredBoundaryIndex, setHoveredBoundaryIndex] = useState<number | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const handleSegmentSelect = useCallback((segment: Segment) => {
        setSelectedSegmentId(segment.id);
        // Clear purple highlight when user clicks on any segment
        setNewBreakpointIndex(null);
        window.requestAnimationFrame(() => {
            const segmentElement = document.getElementById(`segment-${segment.id}`);
            if (segmentElement) {
                segmentElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
        });
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            
            if (message.command === "audioFileSelected") {
                const data = message as AudioFileSelectedMessage;
                if (data.error) {
                    setError(data.error);
                    setIsLoading(false);
                } else {
                    const fileData: AudioFileData = {
                        sessionId: data.sessionId,
                        fileName: data.fileName,
                        durationSec: data.durationSec,
                        segments: data.segments,
                        waveformPeaks: data.waveformPeaks || [],
                        fullAudioUri: data.fullAudioUri,
                        thresholdDb: data.thresholdDb,
                        minDuration: data.minDuration,
                    };
                    setAudioFiles([fileData]);
                    setAudioFile(fileData);
                    setSelectedFileIndex(0);
                    // Update settings to match what was used
                    if (data.thresholdDb !== undefined) {
                        setThresholdDb(data.thresholdDb);
                        setAppliedThresholdDb(data.thresholdDb);
                    }
                    if (data.minDuration !== undefined) {
                        setMinDuration(data.minDuration);
                        setAppliedMinDuration(data.minDuration);
                    }
                    setIsLoading(false);
                    setError(null);
                    
                    if (!documentName || documentName === "AudioDocument") {
                        const nameWithoutExt = data.fileName.replace(/\.[^/.]+$/, "");
                        setDocumentName(nameWithoutExt);
                    }
                }
            } else if (message.command === "audioFilesSelected") {
                const data = message as AudioFilesSelectedMessage;
                if (data.error) {
                    setError(data.error);
                    setIsLoading(false);
                } else {
                    const files: AudioFileData[] = data.files.map(f => ({
                        sessionId: f.sessionId,
                        fileName: f.fileName,
                        durationSec: f.durationSec,
                        segments: f.segments,
                        waveformPeaks: f.waveformPeaks || [],
                        fullAudioUri: f.fullAudioUri,
                        thresholdDb: data.thresholdDb,
                        minDuration: data.minDuration,
                    }));
                    setAudioFiles(files);
                    setAudioFile(files[0] || null);
                    setSelectedFileIndex(0);
                    // Update settings to match what was used
                    if (data.thresholdDb !== undefined) {
                        setThresholdDb(data.thresholdDb);
                        setAppliedThresholdDb(data.thresholdDb);
                    }
                    if (data.minDuration !== undefined) {
                        setMinDuration(data.minDuration);
                        setAppliedMinDuration(data.minDuration);
                    }
                    setIsLoading(false);
                    setError(null);
                    
                    if (!documentName || documentName === "AudioDocument") {
                        const firstFileName = files[0]?.fileName.replace(/\.[^/.]+$/, "") || "AudioDocument";
                        setDocumentName(files.length === 1 ? firstFileName : `${firstFileName} and ${files.length - 1} more`);
                    }
                }
            } else if (message.command === "audioImportProgress") {
                const data = message as AudioImportProgressMessage;
                // Check if progress matches any of the audio files
                const matchingFile = audioFiles.find(f => f.sessionId === data.sessionId);
                if (matchingFile) {
                    setImportProgress({
                        stage: data.stage,
                        message: data.message,
                        progress: data.progress,
                        currentSegment: data.currentSegment,
                        totalSegments: data.totalSegments,
                        etaSeconds: data.etaSeconds,
                    });
                }
            } else if (message.command === "audioImportComplete") {
                const data = message as AudioImportCompleteMessage;
                // Check if completion matches any of the audio files
                const matchingFileIndex = audioFiles.findIndex(f => f.sessionId === data.sessionId);
                if (matchingFileIndex !== -1) {
                    setCompletedImportSessions(prev => {
                        const updated = new Set([...prev, data.sessionId]);
                        
                        if (data.success) {
                            // Check if all files are imported
                            if (updated.size >= audioFiles.length) {
                                // All imports complete
                                setIsImporting(false);
                                setImportProgress(null);
                                setTimeout(() => {
                                    onComplete?.(pendingNotebookPairs.length === 1 ? pendingNotebookPairs : pendingNotebookPairs);
                                }, 500);
                            } else {
                                // More files to import - trigger next import
                                const nextIndex = matchingFileIndex + 1;
                                if (nextIndex < audioFiles.length) {
                                    const nextFile = audioFiles[nextIndex];
                                    const nextNotebookPair = pendingNotebookPairs[nextIndex];
                                    const nextMapping = allSegmentMappings.find(m => m.sessionId === nextFile.sessionId);
                                    if (nextFile && nextNotebookPair && nextMapping) {
                                        vscode.postMessage({
                                            command: "finalizeAudioImport",
                                            sessionId: nextFile.sessionId,
                                            documentName: nextNotebookPair.source.name,
                                            notebookPairs: [nextNotebookPair],
                                            segmentMappings: nextMapping.mappings,
                                        } as FinalizeAudioImportMessage);
                                    }
                                }
                                setImportProgress({
                                    stage: "importing",
                                    message: `Completed ${updated.size}/${audioFiles.length} files. Continuing...`,
                                    progress: (updated.size / audioFiles.length) * 100,
                                });
                            }
                        } else {
                            // Import failed
                            setIsImporting(false);
                            setImportProgress(null);
                            setError(data.error || "Import failed");
                        }
                        
                        return updated;
                    });
                }
            } else if (message.command === "audioSegmentsUpdated") {
                const data = message as AudioSegmentsUpdatedMessage;
                if (data.sessionId === audioFile?.sessionId) {
                    if (!data.success) {
                        setError(data.error || "Failed to update segments");
                    }
                }
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [documentName, audioFiles, audioFile, pendingNotebookPairs, completedImportSessions, allSegmentMappings, onComplete]);

    // Update audioFile when selectedFileIndex changes
    useEffect(() => {
        if (audioFiles.length > 0 && selectedFileIndex >= 0 && selectedFileIndex < audioFiles.length) {
            setAudioFile(audioFiles[selectedFileIndex]);
            setSelectedSegmentId(null);
        }
    }, [selectedFileIndex, audioFiles]);


    const handleSelectFile = useCallback(() => {
        setIsLoading(true);
        setError(null);
        setAudioFile(null);
        vscode.postMessage({ 
            command: "selectAudioFile",
            thresholdDb,
            minDuration,
        } as SelectAudioFileMessage);
    }, [thresholdDb, minDuration]);

    const handleRevert = useCallback(() => {
        setThresholdDb(-40);
        setMinDuration(0.5);
        // Only reprocess if current values differ from defaults
        if (audioFile && (appliedThresholdDb !== -40 || appliedMinDuration !== 0.5)) {
            setIsLoading(true);
            setError(null);
            vscode.postMessage({
                command: "reprocessAudioFile",
                sessionId: audioFile.sessionId,
                thresholdDb: -40,
                minDuration: 0.5,
            } as ReprocessAudioFileMessage);
        }
    }, [audioFile, appliedThresholdDb, appliedMinDuration]);

    const handleApply = useCallback(() => {
        if (!audioFile) return;
        // Only reprocess if values differ from what was last applied
        if (thresholdDb !== appliedThresholdDb || minDuration !== appliedMinDuration) {
            setIsLoading(true);
            setError(null);
            vscode.postMessage({
                command: "reprocessAudioFile",
                sessionId: audioFile.sessionId,
                thresholdDb,
                minDuration,
            } as ReprocessAudioFileMessage);
        }
    }, [audioFile, thresholdDb, minDuration, appliedThresholdDb, appliedMinDuration]);

    const handleDissolveBreakpoint = useCallback((segmentIndex: number) => {
        if (!audioFile || segmentIndex < 0 || segmentIndex >= audioFile.segments.length - 1) return;
        
        const segments = [...audioFile.segments];
        const currentSegment = segments[segmentIndex];
        const nextSegment = segments[segmentIndex + 1];
        
        // Merge segments: keep current start, use next end
        const mergedSegment = {
            ...currentSegment,
            endSec: nextSegment.endSec,
        };
        
        // Replace current and remove next
        segments[segmentIndex] = mergedSegment;
        segments.splice(segmentIndex + 1, 1);
        
        // Automatically split any segments that exceed 30 seconds
        const processedSegments = ensureMaxSegmentLength(segments, audioFile.sessionId);
        
        // Clear purple highlight if this segment was newly added
        if (newBreakpointIndex === segmentIndex || newBreakpointIndex === segmentIndex + 1) {
            setNewBreakpointIndex(null);
        } else if (newBreakpointIndex !== null && newBreakpointIndex > segmentIndex) {
            // Adjust highlight index if segments shifted
            setNewBreakpointIndex(newBreakpointIndex - 1);
        }
        
        // Update local state optimistically
        const updatedFile = {
            ...audioFile,
            segments: processedSegments,
        };
        setAudioFile(updatedFile);
        setAudioFiles(prev => prev.map((f, idx) => 
            idx === selectedFileIndex ? updatedFile : f
        ));
        
        // Send update to backend
        vscode.postMessage({
            command: "updateAudioSegments",
            sessionId: audioFile.sessionId,
            segments: processedSegments.map(s => ({
                id: s.id,
                startSec: s.startSec,
                endSec: s.endSec,
            })),
        } as UpdateAudioSegmentsMessage);
    }, [audioFile, selectedFileIndex, newBreakpointIndex]);

    const handleAddBreakpoint = useCallback((segmentIndex: number) => {
        if (!audioFile || segmentIndex < 0 || segmentIndex >= audioFile.segments.length) return;
        
        const segments = [...audioFile.segments];
        const currentSegment = segments[segmentIndex];
        
        // Split the current segment at its midpoint
        const midpoint = (currentSegment.startSec + currentSegment.endSec) / 2;
        
        // Check if segment is too short to split
        if (currentSegment.endSec - currentSegment.startSec < 0.2) {
            return; // Segment too short
        }
        
        // Create new segment ID
        const newSegmentId = `${audioFile.sessionId}-seg${segments.length + 1}`;
        
        // Split current segment into two
        const firstHalf = {
            ...currentSegment,
            endSec: midpoint,
        };
        const secondHalf = {
            id: newSegmentId,
            startSec: midpoint,
            endSec: currentSegment.endSec,
        };
        
        // Replace current segment with first half, insert second half after it
        segments[segmentIndex] = firstHalf;
        segments.splice(segmentIndex + 1, 0, secondHalf);
        
        // Automatically split any segments that exceed 30 seconds
        const processedSegments = ensureMaxSegmentLength(segments, audioFile.sessionId);
        
        // Highlight the new breakpoint (the boundary we just created)
        setNewBreakpointIndex(segmentIndex);
        
        // Update local state optimistically
        const updatedFile = {
            ...audioFile,
            segments: processedSegments,
        };
        setAudioFile(updatedFile);
        setAudioFiles(prev => prev.map((f, idx) => 
            idx === selectedFileIndex ? updatedFile : f
        ));
        
        // Select and scroll to the new segment in both views
        // Find the segment that starts at the midpoint (the second half)
        requestAnimationFrame(() => {
            const segmentToSelect = processedSegments.find(s => 
                Math.abs(s.startSec - midpoint) < 0.01
            ) || processedSegments[segmentIndex + 1] || processedSegments[segmentIndex];
            if (segmentToSelect) {
                handleSegmentSelect(segmentToSelect);
                // Scroll the segment into view in the list
                setTimeout(() => {
                    const segmentElement = document.getElementById(`segment-${segmentToSelect.id}`);
                    if (segmentElement) {
                        segmentElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }
                }, 100);
            }
        });
        
        // Send update to backend (using processed segments that are all <= 30 seconds)
        vscode.postMessage({
            command: "updateAudioSegments",
            sessionId: audioFile.sessionId,
            segments: processedSegments.map(s => ({
                id: s.id,
                startSec: s.startSec,
                endSec: s.endSec,
            })),
        } as UpdateAudioSegmentsMessage);
    }, [audioFile, handleSegmentSelect]);

    const handlePlaySegment = useCallback(async (segment: Segment) => {
        handleSegmentSelect(segment);
        
        // Stop any currently playing audio first
        if (playingSegmentId) {
            const currentAudio = audioElements.get(playingSegmentId);
            if (currentAudio) {
                currentAudio.pause();
                currentAudio.currentTime = 0;
            }
            setPlayingSegmentId(null);
            
            // Brief delay to ensure pause completes before starting new playback
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!audioFile?.fullAudioUri) {
            setError("Audio file not loaded");
            return;
        }

        // Use the full audio file URI and control playback with currentTime
        let audio = audioElements.get(segment.id);
        if (!audio) {
            audio = new Audio(audioFile.fullAudioUri);
            audio.preload = 'auto';
            audioElements.set(segment.id, audio);
            setAudioElements(new Map(audioElements));
        }

        // Set up timeupdate listener to stop at segment end
        const checkTime = () => {
            // Don't update audio position while user is dragging a boundary
            if (isDragging) return;
            
            if (audio && audio.currentTime >= segment.endSec) {
                audio.pause();
                audio.currentTime = segment.endSec;
                setPlayingSegmentId(null);
                audio.removeEventListener("timeupdate", checkTime);
            }
        };
        audio.addEventListener("timeupdate", checkTime);

        try {
            // Wait for audio to be ready if needed
            if (audio.readyState < 2) {
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        audio.removeEventListener('canplay', onCanPlay);
                        audio.removeEventListener('error', onError);
                        reject(new Error('Audio load timeout'));
                    }, 10000);
                    
                    const onCanPlay = () => {
                        clearTimeout(timeout);
                        audio.removeEventListener('canplay', onCanPlay);
                        audio.removeEventListener('error', onError);
                        resolve();
                    };
                    const onError = () => {
                        clearTimeout(timeout);
                        audio.removeEventListener('canplay', onCanPlay);
                        audio.removeEventListener('error', onError);
                        reject(new Error('Audio failed to load'));
                    };
                    audio.addEventListener('canplay', onCanPlay);
                    audio.addEventListener('error', onError);
                    
                    // If already can play, resolve immediately
                    if (audio.readyState >= 2) {
                        clearTimeout(timeout);
                        audio.removeEventListener('canplay', onCanPlay);
                        audio.removeEventListener('error', onError);
                        resolve();
                    } else {
                        audio.load();
                    }
                });
            }

            // Seek to segment start and play
            audio.currentTime = segment.startSec;
            setPlayingSegmentId(segment.id);
            
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                await playPromise;
            }
        } catch (err: any) {
            // Ignore AbortError - it's expected when switching segments rapidly
            if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
                return;
            }
            console.error("Error playing audio:", err);
            setError("Failed to play audio");
            setPlayingSegmentId(null);
            audio.removeEventListener("timeupdate", checkTime);
        }
    }, [handleSegmentSelect, playingSegmentId, audioElements, audioFile, selectedFileIndex, isDragging]);

    const handleStopPlayback = useCallback(() => {
        if (playingSegmentId) {
            const audio = audioElements.get(playingSegmentId);
            if (audio) {
                audio.pause();
                audio.currentTime = 0;
            }
            setPlayingSegmentId(null);
        }
    }, [playingSegmentId, audioElements]);

    const handleImport = useCallback(() => {
        if (audioFiles.length === 0 || audioFiles.every(f => f.segments.length === 0)) return;

        setIsImporting(true);
        setImportProgress({ stage: "starting", message: "Starting import...", progress: 0 });
        setError(null);

        const notebookPairs: NotebookPair[] = [];
        const allSegmentMappings: Array<{ sessionId: string; mappings: Array<{ segmentId: string; cellId: string; attachmentId: string; fileName: string }> }> = [];

        audioFiles.forEach((file, fileIndex) => {
            if (file.segments.length === 0) return;

            const docId = fileIndex === 0 
                ? documentName.replace(/\.[^/.]+$/, "").replace(/\s+/g, "")
                : `${documentName.replace(/\.[^/.]+$/, "").replace(/\s+/g, "")}_${fileIndex + 1}`;
            const nowIso = new Date().toISOString();
            
            const segmentMappings = file.segments.map((segment, index) => {
                const cellIndex = index + 1;
                const attachmentId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-seg${cellIndex}`;
                const fileName = `${attachmentId}.wav`;
                return {
                    segmentId: segment.id,
                    cellId: `${docId} 1:${cellIndex}`,
                    attachmentId,
                    fileName,
                };
            });

            const sourceCells: ProcessedCell[] = [];
            const codexCells: ProcessedCell[] = [];

            file.segments.forEach((segment, index) => {
                const mapping = segmentMappings[index];
                const cellId = mapping.cellId;
                const attachmentId = mapping.attachmentId;
                const fileName = mapping.fileName;
                const url = `.project/attachments/files/${docId}/${fileName}`;

                sourceCells.push(createProcessedCell(cellId, "", {
                    type: "text" as CodexCellTypes,
                    id: cellId,
                    data: { startTime: segment.startSec, endTime: segment.endSec },
                    edits: [],
                    attachments: {
                        [attachmentId]: {
                            url,
                            type: "audio",
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            isDeleted: false,
                        },
                    },
                    selectedAudioId: attachmentId,
                    selectionTimestamp: Date.now(),
                }));

                codexCells.push(createProcessedCell(cellId, "", {
                    type: "text" as CodexCellTypes,
                    id: cellId,
                    data: { startTime: segment.startSec, endTime: segment.endSec },
                    edits: [],
                    attachments: {},
                }));
            });

            const notebookPair: NotebookPair = {
                source: {
                    name: docId,
                    cells: sourceCells,
                    metadata: {
                        id: docId,
                        originalFileName: file.fileName,
                        importerType: "audio",
                        createdAt: nowIso,
                        audioOnly: true,
                        importContext: {
                            importerType: "audio",
                            fileName: file.fileName,
                            originalFileName: file.fileName,
                            importTimestamp: nowIso,
                            thresholdDb: file.thresholdDb,
                            minDuration: file.minDuration,
                        },
                    },
                },
                codex: {
                    name: docId,
                    cells: codexCells,
                    metadata: {
                        id: docId,
                        originalFileName: file.fileName,
                        importerType: "audio",
                        createdAt: nowIso,
                        audioOnly: true,
                        importContext: {
                            importerType: "audio",
                            fileName: file.fileName,
                            originalFileName: file.fileName,
                            importTimestamp: nowIso,
                            thresholdDb: file.thresholdDb,
                            minDuration: file.minDuration,
                        },
                    },
                },
            };

            // Add milestone cells to the notebook pair
            const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);
            notebookPairs.push(notebookPairWithMilestones);
            allSegmentMappings.push({ sessionId: file.sessionId, mappings: segmentMappings });
        });

        setPendingNotebookPairs(notebookPairs);
        setAllSegmentMappings(allSegmentMappings);
        setCompletedImportSessions(new Set());

        // Import all files sequentially
        const importNext = async (index: number) => {
            if (index >= audioFiles.length) {
                // All imports complete
                setIsImporting(false);
                setImportProgress(null);
                setTimeout(() => {
                    onComplete?.(notebookPairs.length === 1 ? notebookPairs : notebookPairs);
                }, 500);
                return;
            }

            const file = audioFiles[index];
            const mapping = allSegmentMappings.find(m => m.sessionId === file.sessionId);
            const notebookPair = notebookPairs[index];

            if (mapping && notebookPair) {
                vscode.postMessage({
                    command: "finalizeAudioImport",
                    sessionId: file.sessionId,
                    documentName: notebookPair.source.name,
                    notebookPairs: [notebookPair],
                    segmentMappings: mapping.mappings,
                } as FinalizeAudioImportMessage);
            }

            // Wait for import to complete before starting next
            // This will be handled by the audioImportComplete message handler
        };

        // Start importing first file
        importNext(0);
    }, [audioFiles, documentName, onComplete]);

    const waveformPeaks = audioFile?.waveformPeaks || [];
    const maxPeak = waveformPeaks.length > 0 ? Math.max(...waveformPeaks) : 1;
    const waveformHeight = 80;
    const minCanvasWidth = 800;
    const maxCanvasWidth = 16000; // Safe browser limit
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
    
    // Calculate adaptive pixels per second to fit within safe canvas size
    // For long files, reduce zoom; for short files, increase zoom
    // Default zoom is 3x (150 pixels per second instead of 50)
    const canvasWidth = React.useMemo(() => {
        if (!audioFile || !isFinite(audioFile.durationSec) || audioFile.durationSec <= 0) return minCanvasWidth;
        const pixelsPerSecond = Math.min(150, maxCanvasWidth / audioFile.durationSec);
        const calculated = audioFile.durationSec * pixelsPerSecond;
        const clamped = Math.min(maxCanvasWidth, Math.max(minCanvasWidth, calculated));
        // Ensure integer and safe array size (max ~2^31-1)
        const safeMax = Math.min(maxCanvasWidth, 2147483647);
        return Math.floor(Math.min(safeMax, Math.max(minCanvasWidth, clamped)));
    }, [audioFile]);

    // Debug logging
    React.useEffect(() => {
        if (audioFile) {
            const nonZeroPeaks = waveformPeaks.filter(p => p > 0);
            console.log("[AudioImporter] Waveform data:", {
                peaksLength: waveformPeaks.length,
                maxPeak,
                nonZeroPeaksCount: nonZeroPeaks.length,
                durationSec: audioFile.durationSec,
                canvasWidth,
                pointsPerSecond: audioFile.durationSec > 0 ? waveformPeaks.length / audioFile.durationSec : 0,
                firstFew: waveformPeaks.slice(0, 20),
                lastFew: waveformPeaks.slice(-20),
                sampleValues: waveformPeaks.filter((p, i) => i % 100 === 0),
                allZeros: waveformPeaks.every(p => p === 0),
            });
        }
    }, [audioFile, waveformPeaks, maxPeak, canvasWidth]);

    // Convert pixel X to time in seconds
    const pixelToTime = useCallback((x: number): number => {
        if (!audioFile) return 0;
        return (x / canvasWidth) * audioFile.durationSec;
    }, [audioFile, canvasWidth]);

    // Convert time in seconds to pixel X
    const timeToPixel = useCallback((timeSec: number): number => {
        if (!audioFile) return 0;
        return (timeSec / audioFile.durationSec) * canvasWidth;
    }, [audioFile, canvasWidth]);

    // Scroll waveform to show selected segment
    React.useEffect(() => {
        if (!audioFile || !selectedSegmentId || !scrollContainerRef.current || !canvasWidth) return;
        const segment = audioFile.segments.find(s => s.id === selectedSegmentId);
        if (!segment) return;
        
        const container = scrollContainerRef.current;
        if (!container) return;
        
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
            // Inline calculation to avoid callback dependency issues
            const startX = (segment.startSec / audioFile.durationSec) * canvasWidth;
            const endX = (segment.endSec / audioFile.durationSec) * canvasWidth;
            const segmentCenter = (startX + endX) / 2;
            const targetLeft = Math.max(0, segmentCenter - container.clientWidth / 2);
            const clampedLeft = Math.min(targetLeft, Math.max(0, container.scrollWidth - container.clientWidth));
            container.scrollTo({ left: clampedLeft, behavior: "smooth" });
        });
    }, [audioFile, selectedSegmentId, canvasWidth]);

    // Find boundary index near mouse position
    const findBoundaryNear = useCallback((mouseX: number, tolerance: number = 5): number | null => {
        if (!audioFile || !canvasRef.current) return null;
        
        const segments = audioFile.segments;
        // Check boundaries between segments (endSec of segment i = startSec of segment i+1)
        for (let i = 0; i < segments.length - 1; i++) {
            const boundaryTime = segments[i].endSec;
            const boundaryX = timeToPixel(boundaryTime);
            if (Math.abs(mouseX - boundaryX) <= tolerance) {
                return i; // Boundary index (segment index before the boundary)
            }
        }
        return null;
    }, [audioFile, timeToPixel]);

    // Handle mouse down on canvas
    const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current || !audioFile || isDragging) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const boundaryIndex = findBoundaryNear(x);
        
        if (boundaryIndex !== null) {
            // Pause audio if playing while user drags boundary
            if (playingSegmentId) {
                const audio = audioElements.get(playingSegmentId);
                if (audio && !audio.paused) {
                    audio.pause();
                }
            }
            
            // Clear purple highlight when clicking on any boundary
            setNewBreakpointIndex(null);
            // Select the segment that starts at this boundary (the segment after the boundary)
            const segmentIndex = boundaryIndex + 1;
            if (segmentIndex < audioFile.segments.length) {
                const segment = audioFile.segments[segmentIndex];
                handleSegmentSelect(segment);
            }
            // Start dragging a boundary
            setIsDragging(true);
            setDraggedBoundaryIndex(boundaryIndex);
            setDragStartX(x);
            setDragStartTime(audioFile.segments[boundaryIndex].endSec);
            e.preventDefault();
        } else {
            // Click on segment - select it
            const clickTime = pixelToTime(x);
            const segment = audioFile.segments.find(s => clickTime >= s.startSec && clickTime <= s.endSec);
            if (segment) {
                handleSegmentSelect(segment);
            }
        }
    }, [audioFile, isDragging, findBoundaryNear, pixelToTime, handleSegmentSelect, playingSegmentId, audioElements]);

    // Handle mouse move
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || draggedBoundaryIndex === null || !canvasRef.current || !audioFile) return;

            const rect = canvasRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const newTime = pixelToTime(x);
            
            // Constrain to adjacent segments
            const segments = audioFile.segments;
            const prevSegment = segments[draggedBoundaryIndex];
            const nextSegment = segments[draggedBoundaryIndex + 1];
            
            const minTime = prevSegment.startSec + 0.1; // Minimum 0.1s segment
            const maxTime = nextSegment.endSec - 0.1; // Minimum 0.1s segment
            const constrainedTime = Math.max(minTime, Math.min(maxTime, newTime));
            
            // Update segments optimistically
            setAudioFile(prev => {
                if (!prev) return null;
                const updatedSegments = [...prev.segments];
                updatedSegments[draggedBoundaryIndex] = {
                    ...updatedSegments[draggedBoundaryIndex],
                    endSec: constrainedTime,
                };
                updatedSegments[draggedBoundaryIndex + 1] = {
                    ...updatedSegments[draggedBoundaryIndex + 1],
                    startSec: constrainedTime,
                };
                
                // Automatically split any segments that exceed 30 seconds
                const processedSegments = ensureMaxSegmentLength(updatedSegments, prev.sessionId);
                
                const updatedFile = { ...prev, segments: processedSegments };
                // Also update audioFiles array
                setAudioFiles(prevFiles => prevFiles.map((f, idx) => 
                    idx === selectedFileIndex ? updatedFile : f
                ));
                return updatedFile;
            });
        };

        if (isDragging) {
            window.addEventListener("mousemove", handleMouseMove);
            return () => window.removeEventListener("mousemove", handleMouseMove);
        }
    }, [isDragging, draggedBoundaryIndex, audioFile, pixelToTime, selectedFileIndex]);

    // Handle mouse up - finalize drag and send update
    useEffect(() => {
        const handleMouseUp = () => {
            if (!isDragging || draggedBoundaryIndex === null || !audioFile) return;

            setIsDragging(false);
            
            // Ensure all segments are under 30 seconds before sending to backend
            const processedSegments = ensureMaxSegmentLength(audioFile.segments, audioFile.sessionId);
            
            // Send update to backend
            vscode.postMessage({
                command: "updateAudioSegments",
                sessionId: audioFile.sessionId,
                segments: processedSegments.map(s => ({
                    id: s.id,
                    startSec: s.startSec,
                    endSec: s.endSec,
                })),
            } as UpdateAudioSegmentsMessage);

            setDraggedBoundaryIndex(null);
            setDragStartX(0);
            setDragStartTime(0);
        };

        if (isDragging) {
            window.addEventListener("mouseup", handleMouseUp);
            return () => window.removeEventListener("mouseup", handleMouseUp);
        }
    }, [isDragging, draggedBoundaryIndex, audioFile]);

    // Handle mouse move for hover detection
    const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current || isDragging) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const boundaryIndex = findBoundaryNear(x);
        setHoveredBoundaryIndex(boundaryIndex);
    }, [isDragging, findBoundaryNear]);

    // Draw waveform on canvas - show volume/amplitude over time with segment boundaries
    React.useEffect(() => {
        if (!canvasRef.current || !audioFile) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = canvasWidth * window.devicePixelRatio;
        canvas.height = waveformHeight * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        const width = canvasWidth;
        const height = waveformHeight;
        const centerY = height / 2;

        // Clear canvas
        ctx.fillStyle = "#f3f4f6";
        ctx.fillRect(0, 0, width, height);

        // Draw center line
        ctx.strokeStyle = "#e5e7eb";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();

        // Only draw waveform if we have valid peaks
        // Waveform now covers the entire file duration at lower resolution
        if (waveformPeaks.length > 0 && maxPeak > 0) {
            // Ensure width is a safe integer for array creation
            const safeWidth = Math.floor(Math.max(1, Math.min(width, 2147483647)));
            if (!isFinite(safeWidth) || safeWidth <= 0) {
                ctx.fillStyle = "#9ca3af";
                ctx.font = "12px sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("Invalid canvas width", width / 2, centerY);
                return;
            }
            const peaksPerPixel = waveformPeaks.length / safeWidth;
            const amplitudes: number[] = new Array(safeWidth).fill(0);

            for (let x = 0; x < safeWidth; x++) {
                const startPeak = Math.floor(x * peaksPerPixel);
                if (startPeak >= waveformPeaks.length) {
                    amplitudes[x] = 0;
                    continue;
                }
                let endPeak = Math.floor((x + 1) * peaksPerPixel);
                endPeak = Math.min(waveformPeaks.length, Math.max(startPeak + 1, endPeak));

                let sum = 0;
                let count = 0;
                for (let i = startPeak; i < endPeak; i++) {
                    sum += waveformPeaks[i];
                    count += 1;
                }

                const averagePeak = count > 0 ? sum / count : waveformPeaks[startPeak];
                const normalized = maxPeak > 0 ? averagePeak / maxPeak : 0;
                amplitudes[x] = Math.max(0, normalized * (height / 2 - 6));
            }

            // Filled waveform area
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            for (let x = 0; x < safeWidth; x++) {
                ctx.lineTo(x, centerY - amplitudes[x]);
            }
            ctx.lineTo(safeWidth, centerY);
            for (let x = safeWidth - 1; x >= 0; x--) {
                ctx.lineTo(x, centerY + amplitudes[x]);
            }
            ctx.closePath();
            ctx.fillStyle = "rgba(59, 130, 246, 0.35)";
            ctx.fill();

            // Outline for upper and lower envelopes
            ctx.beginPath();
            ctx.moveTo(0, centerY - amplitudes[0]);
            for (let x = 0; x < safeWidth; x++) {
                ctx.lineTo(x, centerY - amplitudes[x]);
            }
            ctx.strokeStyle = "#2563eb";
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(0, centerY + amplitudes[0]);
            for (let x = 0; x < safeWidth; x++) {
                ctx.lineTo(x, centerY + amplitudes[x]);
            }
            ctx.strokeStyle = "#2563eb";
            ctx.lineWidth = 1.5;
            ctx.stroke();
        } else {
            // No waveform data - show placeholder
            ctx.fillStyle = "#9ca3af";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("Waveform data unavailable", width / 2, centerY);
        }

        // Draw segment backgrounds for selected segment
        const segments = audioFile.segments;
        if (selectedSegmentId) {
            const segment = segments.find(s => s.id === selectedSegmentId);
            if (segment) {
                const startX = timeToPixel(segment.startSec);
                const endX = timeToPixel(segment.endSec);
                ctx.fillStyle = "rgba(34, 197, 94, 0.18)"; // Green highlight
                ctx.fillRect(startX, 0, endX - startX, height);
            }
        }

        // Draw segment boundaries
        for (let i = 0; i < segments.length - 1; i++) {
            const boundaryTime = segments[i].endSec;
            const x = timeToPixel(boundaryTime);
            
            const isHovered = hoveredBoundaryIndex === i;
            const isDragged = draggedBoundaryIndex === i;
            const currentSegmentIndex = selectedSegmentId 
                ? segments.findIndex(s => s.id === selectedSegmentId)
                : -1;
            const isSelectedBoundary = currentSegmentIndex >= 0 && (i === currentSegmentIndex - 1 || i === currentSegmentIndex);
            const isNewBreakpoint = newBreakpointIndex === i;

            let strokeStyle = "#94a3b8";
            if (isNewBreakpoint) {
                strokeStyle = "#a855f7"; // Purple for newly added breakpoints
            } else if (isSelectedBoundary) {
                strokeStyle = "#22c55e";
            } else if (isHovered) {
                strokeStyle = "#f97316";
            } else if (isDragged) {
                strokeStyle = "#ef4444";
            }

            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = isDragged || isHovered || isSelectedBoundary || isNewBreakpoint ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
    }, [waveformPeaks, maxPeak, audioFile, canvasWidth, timeToPixel, hoveredBoundaryIndex, draggedBoundaryIndex, selectedSegmentId, newBreakpointIndex]);

    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Music className="h-5 w-5" />
                        Import Audio File{audioFiles.length > 1 ? `s (${audioFiles.length})` : ""}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {audioFiles.length > 1 && (
                        <div className="flex gap-2 overflow-x-auto pb-2 border-b">
                            {audioFiles.map((file, index) => (
                                <Button
                                    key={file.sessionId}
                                    variant={selectedFileIndex === index ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => setSelectedFileIndex(index)}
                                    className="whitespace-nowrap"
                                >
                                    {file.fileName}
                                </Button>
                            ))}
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label htmlFor="doc-name">Document Name</Label>
                        <Input
                            id="doc-name"
                            value={documentName}
                            onChange={(e) => setDocumentName(e.target.value)}
                            placeholder="Enter document name"
                            className="w-full"
                            disabled={!!audioFile}
                        />
                    </div>

                    {/* VAD Settings */}
                    <div className="space-y-2 border rounded p-3">
                        <Button 
                            variant="ghost" 
                            size="sm" 
                            className="w-full justify-between p-0 h-auto"
                            onClick={() => setShowVADSettings(!showVADSettings)}
                        >
                            <span className="flex items-center gap-2">
                                <Settings className="h-4 w-4" />
                                Voice Activity Detection Settings
                            </span>
                            {showVADSettings ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                        {showVADSettings && (
                            <div className="space-y-4 pt-2">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Silence Threshold: {thresholdDb} dB</Label>
                                        <span className="text-xs text-muted-foreground">{thresholdDb >= -35 ? "Less sensitive" : thresholdDb <= -45 ? "More sensitive" : "Balanced"}</span>
                                    </div>
                                    <Slider
                                        value={[thresholdDb]}
                                        onValueChange={([val]) => setThresholdDb(val)}
                                        min={-60}
                                        max={-20}
                                        step={1}
                                        disabled={isLoading || isImporting}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Lower values detect quieter sounds as speech (range: -60 to -20 dB)
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label>Min Silence Duration: {minDuration.toFixed(1)}s</Label>
                                        <span className="text-xs text-muted-foreground">{minDuration <= 0.3 ? "More segments" : minDuration >= 1.0 ? "Fewer segments" : "Balanced"}</span>
                                    </div>
                                    <Slider
                                        value={[minDuration]}
                                        onValueChange={([val]) => setMinDuration(val)}
                                        min={0.1}
                                        max={2.0}
                                        step={0.1}
                                        disabled={isLoading || isImporting}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Minimum silence duration to split segments (range: 0.1 to 2.0 seconds)
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {!audioFile && (
                        <div className="flex justify-center py-8">
                            <Button
                                onClick={handleSelectFile}
                                disabled={isLoading}
                                variant="outline"
                                size="lg"
                            >
                                {isLoading ? (
                                    <>Processing...</>
                                ) : (
                                    <>
                                        <Upload className="mr-2 h-4 w-4" />
                                        Select Audio File{audioFiles.length > 0 ? "s" : ""}
                                    </>
                                )}
                            </Button>
                        </div>
                    )}

                    {isLoading && (
                        <div className="space-y-2">
                            <Progress value={undefined} className="w-full" />
                            <p className="text-sm text-muted-foreground text-center">
                                Processing audio file...
                            </p>
                        </div>
                    )}

                    {error && (
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {audioFile && (
                        <div className="space-y-4">
                            <Alert>
                                <Check className="h-4 w-4" />
                                <AlertDescription>
                                    <div className="flex justify-between items-center flex-wrap gap-2">
                                        <span>
                                            {audioFile.fileName} • {formatDuration(audioFile.durationSec)} • {audioFile.segments.length} segments
                                            {audioFile.thresholdDb !== undefined && audioFile.minDuration !== undefined && (
                                                <span className="text-xs text-muted-foreground ml-2">
                                                    (VAD: {audioFile.thresholdDb}dB, {audioFile.minDuration.toFixed(1)}s)
                                                </span>
                                            )}
                                        </span>
                                        <div className="flex gap-2">
                                            <Button
                                                onClick={handleRevert}
                                                disabled={isLoading || isImporting}
                                                variant="outline"
                                                size="sm"
                                            >
                                                Revert
                                            </Button>
                                            <Button
                                                onClick={handleApply}
                                                disabled={isLoading || isImporting || (thresholdDb === appliedThresholdDb && minDuration === appliedMinDuration)}
                                                variant="default"
                                                size="sm"
                                            >
                                                Apply
                                            </Button>
                                        </div>
                                    </div>
                                </AlertDescription>
                            </Alert>

                            {waveformPeaks.length > 0 && maxPeak > 0 ? (
                                <div className="bg-muted rounded p-4">
                                    <div className="text-xs text-muted-foreground mb-2">
                                        Waveform Preview ({waveformPeaks.length} points, max: {maxPeak.toFixed(4)}) • Drag red lines to adjust segments
                                    </div>
                                    <div 
                                        ref={scrollContainerRef}
                                        className="overflow-x-auto rounded"
                                        style={{ cursor: isDragging ? 'grabbing' : hoveredBoundaryIndex !== null ? 'grab' : 'default' }}
                                    >
                                        <canvas
                                            ref={canvasRef}
                                            className="rounded"
                                            style={{ 
                                                height: `${waveformHeight}px`, 
                                                width: `${canvasWidth}px`,
                                                backgroundColor: "#f3f4f6",
                                                display: 'block'
                                            }}
                                            onMouseDown={handleCanvasMouseDown}
                                            onMouseMove={handleCanvasMouseMove}
                                        />
                                    </div>
                                </div>
                            ) : waveformPeaks.length > 0 ? (
                                <div className="bg-muted rounded p-4">
                                    <div className="text-xs text-muted-foreground">
                                        Waveform data received but all values are zero ({waveformPeaks.length} points)
                                    </div>
                                </div>
                            ) : null}

                            <div className="space-y-2">
                                <div className="text-sm font-medium">Segments ({audioFile.segments.length})</div>
                                <div className="max-h-96 overflow-y-auto space-y-2">
                                    {audioFile.segments.map((segment, index) => (
                                        <Card 
                                            key={segment.id} 
                                            id={`segment-${segment.id}`}
                                            className={`p-3 cursor-pointer transition-colors ${selectedSegmentId === segment.id ? "border-green-500 bg-green-50/70 shadow-sm" : "hover:bg-muted/60"}`}
                                            onClick={() => handleSegmentSelect(segment)}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3 flex-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (playingSegmentId === segment.id) {
                                                                handleStopPlayback();
                                                            } else {
                                                                handlePlaySegment(segment);
                                                            }
                                                        }}
                                                        disabled={false}
                                                    >
                                                        {playingSegmentId === segment.id ? (
                                                            <Pause className="h-4 w-4" />
                                                        ) : (
                                                            <Play className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                    <div className="flex-1">
                                                        <div className="text-sm font-medium">
                                                            Segment {segment.id.split("-").pop()}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {formatSeconds(segment.startSec)} - {formatSeconds(segment.endSec)}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {index < audioFile.segments.length - 1 && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDissolveBreakpoint(index);
                                                            }}
                                                            title="Delete breakpoint (merge with next segment)"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleAddBreakpoint(index);
                                                        }}
                                                        disabled={segment.endSec - segment.startSec < 0.2}
                                                        title="Split this segment at midpoint"
                                                    >
                                                        <Plus className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            </div>

                            {isImporting && importProgress && (
                                <Alert>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium">{importProgress.stage}</span>
                                            <div className="flex items-center gap-3">
                                                {importProgress.etaSeconds !== undefined && (
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatETA(importProgress.etaSeconds)} remaining
                                                    </span>
                                                )}
                                                {importProgress.progress !== undefined && (
                                                    <span className="text-sm text-muted-foreground">
                                                        {Math.round(importProgress.progress)}%
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {importProgress.message}
                                            {importProgress.currentSegment !== undefined && importProgress.totalSegments !== undefined && (
                                                <span className="ml-2">
                                                    ({importProgress.currentSegment}/{importProgress.totalSegments})
                                                </span>
                                            )}
                                        </p>
                                        {importProgress.progress !== undefined && (
                                            <Progress value={importProgress.progress} className="w-full" />
                                        )}
                                    </div>
                                </Alert>
                            )}

                            <div className="flex gap-2 justify-end pt-4 border-t">
                                <Button variant="ghost" onClick={onCancel} disabled={isImporting}>
                                    <ArrowLeft className="mr-2 h-4 w-4" />
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleImport}
                                    disabled={audioFile.segments.length === 0 || isImporting}
                                >
                                    {isImporting ? (
                                        <>Importing...</>
                                    ) : (
                                        <>Import {audioFile.segments.length} Segment{audioFile.segments.length !== 1 ? "s" : ""}</>
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

