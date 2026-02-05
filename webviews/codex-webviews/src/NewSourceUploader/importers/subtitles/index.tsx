import { ImporterPlugin } from "../../types/plugin";
import { Play } from "lucide-react";
import { SubtitlesImporterForm } from "./SubtitlesImporterForm";
import { subtitlesCellAligner } from "./aligner";
export { parseFile } from "./index";

export const subtitlesImporterPlugin: ImporterPlugin = {
    id: "subtitles",
    name: "Subtitle Files",
    description: "Import VTT/SRT subtitle files with timestamp-based cells",
    icon: Play,
    component: SubtitlesImporterForm,
    cellAligner: subtitlesCellAligner,
    supportedExtensions: ["vtt", "srt"],
    enabled: true,
    tags: ["Media", "Timed"],
};
