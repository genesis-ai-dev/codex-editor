import { ImporterPlugin } from "../../types/plugin";
import { FileText } from "lucide-react";
import { MarkdownImporterForm } from "./MarkdownImporterForm";

export const markdownImporterPlugin: ImporterPlugin = {
    id: "markdown",
    name: "Markdown Documents",
    description: "Import Markdown files with GitHub Flavored Markdown support",
    icon: FileText,
    component: MarkdownImporterForm,
    supportedExtensions: ["md", "markdown", "mdown", "mkd"],
    enabled: true,
};
