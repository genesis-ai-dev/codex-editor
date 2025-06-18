import { ImporterPlugin } from "../../types/plugin";
import { BookOpenCheck } from "lucide-react";
import { ObsImporterForm } from "./ObsImporterForm";

export const obsImporterPlugin: ImporterPlugin = {
    id: "obs",
    name: "Open Bible Stories",
    description:
        "Import Open Bible Stories markdown files from unfoldingWord or upload individual files",
    icon: BookOpenCheck,
    component: ObsImporterForm,
    supportedExtensions: ["md", "zip"],
    enabled: true,
    tags: ["stories", "download", "repository"],
};
