import { ImporterPlugin } from "../../types/plugin";
import { Play } from "lucide-react";
import { SubtitlesImporterForm } from "./SubtitlesImporterForm";

export const subtitlesImporterPlugin: ImporterPlugin = {
    id: "subtitles",
    name: "Subtitle Files",
    description: "Import VTT/SRT subtitle files with timestamp-based cells",
    icon: Play,
    component: SubtitlesImporterForm,
    supportedExtensions: ["vtt", "srt"],
    enabled: true,
    tags: ["Media", "Timed"],
};
