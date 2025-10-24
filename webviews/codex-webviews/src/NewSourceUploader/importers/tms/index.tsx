import { ImporterPlugin } from "../../types/plugin";
import { FileCode } from "lucide-react";
import { TmxImporterForm } from "./tmxImporterForm";

export const tmsImporterPlugin: ImporterPlugin = {
    id: "translation-importer",
    name: "Translation Files",
    description: "TMX and XLIFF translation memory and localization files",
    icon: FileCode,
    component: TmxImporterForm,
    supportedExtensions: ["tmx", "xliff", "xlf"],
    enabled: true,
    tags: ["Essential", "Translation", "Localization"],
};