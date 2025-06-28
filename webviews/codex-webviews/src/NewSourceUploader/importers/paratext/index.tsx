import React from "react";
import { ImporterPlugin } from "../../types/plugin";
import { Database } from "lucide-react";
import { ParatextImporterForm } from "./ParatextImporterForm";

// Re-export the core importer functions
export { paratextImporter } from "./parser";

// Plugin definition for the registry
export const paratextImporterPlugin: ImporterPlugin = {
    id: "paratext",
    name: "Paratext Projects",
    description:
        "Import Paratext translation projects with USFM files, project settings, and book names",
    icon: Database,
    component: ParatextImporterForm,
    supportedExtensions: ["zip", "folder"],
    supportedMimeTypes: [
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
    ],
    enabled: true,
};
