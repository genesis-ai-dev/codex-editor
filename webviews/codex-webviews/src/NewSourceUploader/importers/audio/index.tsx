import React from "react";
import { ImporterPlugin } from "../../types/plugin";
import { Music } from "lucide-react";
import { AudioImporterForm } from "./AudioImporterForm";

export const audioImporterPlugin: ImporterPlugin = {
    id: "audio",
    name: "Audio",
    description: "Import audio files with backend processing - supports large files",
    icon: Music as any,
    component: AudioImporterForm,
    supportedExtensions: [
        "mp3",
        "wav",
        "m4a",
        "aac",
        "ogg",
        "webm",
        "flac",
    ],
    supportedMimeTypes: [
        "audio/mpeg",
        "audio/wav",
        "audio/mp4",
        "audio/aac",
        "audio/ogg",
        "audio/webm",
        "audio/flac",
    ],
    enabled: true,
};

