import { ImporterPlugin } from "../../types/plugin";
import { FileText } from "lucide-react";
import { DocxImporterForm } from "./DocxImporterForm";

// Re-export the parsing functions from the existing index.ts
export { validateFile, parseFile } from "./index";

export const docxImporterPlugin: ImporterPlugin = {
    id: "docx",
    name: "DOCX Documents",
    description: "Import Microsoft Word DOCX files with rich formatting and images",
    icon: FileText,
    component: DocxImporterForm,
    supportedExtensions: ["docx"],
    enabled: true,
};
