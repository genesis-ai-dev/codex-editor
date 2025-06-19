import { ImporterPlugin } from "../../types/plugin";
import { Scissors } from "lucide-react";
import { RecursiveTextSplitterForm } from "./RecursiveTextSplitterForm.tsx";

export const recursiveTextSplitterPlugin: ImporterPlugin = {
    id: "recursive-text-splitter",
    name: "Recursive Text Splitter",
    description:
        "Split any text document using intelligent recursive splitting with configurable separators",
    icon: Scissors,
    component: RecursiveTextSplitterForm,
    supportedExtensions: [
        "txt",
        "text",
        "md",
        "markdown",
        "csv",
        "tsv",
        "json",
        "log",
        "xml",
        "html",
        "css",
        "js",
        "ts",
        "py",
        "java",
        "cpp",
        "c",
        "h",
    ],
    tags: ["Text Processing", "AI-Ready", "Configurable"],
    enabled: true,
};
