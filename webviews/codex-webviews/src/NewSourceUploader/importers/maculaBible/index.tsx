import { ImporterPlugin } from "../../types/plugin";
import { Languages } from "lucide-react";
import { MaculaBibleImporterForm } from "./MaculaBibleImporterForm";

export const maculaBibleImporterPlugin: ImporterPlugin = {
    id: "macula-bible",
    name: "Macula Bible",
    description: "Hebrew and Greek Bible with morphological annotations",
    icon: Languages,
    component: MaculaBibleImporterForm,
    supportedExtensions: [], // No file extensions - this downloads remotely
    enabled: true,
};
