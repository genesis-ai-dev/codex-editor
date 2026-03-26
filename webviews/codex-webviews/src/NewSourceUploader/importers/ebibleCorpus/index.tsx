import { ImporterPlugin } from "../../types/plugin";
import { Globe } from "lucide-react";
import { EbibleDownloadImporterForm } from "./EbibleDownloadImporterForm";

export const ebibleDownloadImporterPlugin: ImporterPlugin = {
    id: "ebible-download",
    name: "eBible Download",
    description: "Download Bible translations directly from eBible.org",
    icon: Globe,
    component: EbibleDownloadImporterForm,
    supportedExtensions: [], // No file extensions - this downloads remotely
    enabled: true,
};
