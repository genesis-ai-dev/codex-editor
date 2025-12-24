import { ImporterPlugin } from "../../../types/plugin";
import { BookOpen } from "lucide-react";
import { UsfmImporterForm } from "./UsfmImporterForm";

export const usfmExperimentalImporterPlugin: ImporterPlugin = {
    id: "usfm-experimental",
    name: "USFM Biblical Texts (Experimental)",
    description: "Import Unified Standard Format Marker files for biblical texts with round-trip export support",
    icon: BookOpen,
    component: UsfmImporterForm,
    supportedExtensions: ["usfm", "sfm", "SFM", "USFM"],
    enabled: true,
};

