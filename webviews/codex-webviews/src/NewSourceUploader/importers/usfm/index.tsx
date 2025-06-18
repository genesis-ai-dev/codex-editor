import { ImporterPlugin } from "../../types/plugin";
import { BookOpen } from "lucide-react";
import { UsfmImporterForm } from "./UsfmImporterForm";

export const usfmImporterPlugin: ImporterPlugin = {
    id: "usfm",
    name: "USFM Biblical Texts",
    description: "Import Unified Standard Format Marker files for biblical texts",
    icon: BookOpen,
    component: UsfmImporterForm,
    supportedExtensions: ["usfm", "sfm", "SFM", "USFM"],
    enabled: true,
};
