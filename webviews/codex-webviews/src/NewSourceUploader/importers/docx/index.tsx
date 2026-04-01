import { ImporterPlugin } from "../../types/plugin";
import { FileText } from "lucide-react";
import { DocxImporterForm } from "./DocxImporterForm";

// Re-export for convenience
export { validateFile, parseFile, docxImporter } from "./index";

export const docxRoundtripImporterPlugin: ImporterPlugin = {
    id: "docx",
    name: "Word Documents",
    description: "Import Microsoft Word DOCX files with complete structure preservation for export",
    icon: FileText,
    component: DocxImporterForm,
    supportedExtensions: ["docx"],
    supportedMimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    enabled: true,
};

