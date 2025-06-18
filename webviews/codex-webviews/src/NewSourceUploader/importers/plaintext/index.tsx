import { ImporterPlugin } from "../../types/plugin";
import { FileText } from "lucide-react";
import { PlaintextImporterForm } from "./PlaintextImporterForm";

export const plaintextImporterPlugin: ImporterPlugin = {
    id: "plaintext",
    name: "Plain Text Files",
    description: "Import plain text files with intelligent structure detection",
    icon: FileText,
    component: PlaintextImporterForm,
    supportedExtensions: ["txt", "text"],
    enabled: true,
};
