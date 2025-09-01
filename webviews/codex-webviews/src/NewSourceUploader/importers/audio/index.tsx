import React from "react";
import { ImporterPlugin } from "../../types/plugin";
import { Mic } from "lucide-react";
import { AudioImporterForm } from "./AudioImporterForm";

export const audioImporterPlugin: ImporterPlugin = {
    id: "audio",
    name: "Audio",
    description: "Import audio files, segment by timestamps, optionally merge multiple audio files",
    icon: Mic as any,
    component: AudioImporterForm,
    supportedExtensions: [
        "mp3",
        "wav",
        "m4a",
        "aac",
        "ogg",
        "webm",
        "flac",
        // "mp4",
        // "mov",
        // "avi",
        // "mkv",
    ],
    supportedMimeTypes: [
        "audio/mpeg",
        "audio/wav",
        "audio/mp4",
        "audio/aac",
        "audio/ogg",
        "audio/webm",
        "audio/flac",
        // "video/mp4",
        // "video/quicktime",
        // "video/x-msvideo",
        // "video/x-matroska",
        // "video/webm",
    ],
    enabled: true,
    tags: ["Essential", "Media", "Audio"],
};
