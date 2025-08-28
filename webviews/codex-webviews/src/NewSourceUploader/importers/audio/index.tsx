import React from "react";
import { ImporterPlugin } from "../../types/plugin";
import { Mic } from "lucide-react";
import { AudioImporterForm } from "./AudioImporterForm";

export const audioImporterPlugin: ImporterPlugin = {
    id: "audio",
    name: "Audio",
    description: "Import audio files and segment by timestamps",
    icon: Mic as any,
    component: AudioImporterForm,
    supportedExtensions: ["mp3", "wav", "m4a", "aac", "ogg", "webm", "flac"],
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
    tags: ["Essential", "Media", "Audio"],
};
