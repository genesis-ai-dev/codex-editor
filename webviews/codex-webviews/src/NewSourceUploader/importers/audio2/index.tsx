import React from "react";
import { ImporterPlugin } from "../../types/plugin";
import { Music } from "lucide-react";
import { AudioImporter2Form } from "./AudioImporter2Form";

export const audioImporter2Plugin: ImporterPlugin = {
    id: "audio2",
    name: "Audio",
    description: "Import audio files with backend processing - supports large files",
    icon: Music as any,
    component: AudioImporter2Form,
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
    tags: ["Essential", "Media", "Audio"],
};

