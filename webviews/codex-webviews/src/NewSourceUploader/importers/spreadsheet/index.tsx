import { ImporterPlugin } from "../../types/plugin";
import { Table } from "lucide-react";
import { SpreadsheetImporterForm } from "./SpreadsheetImporterForm";

export const spreadsheetImporterPlugin: ImporterPlugin = {
    id: "spreadsheet",
    name: "Spreadsheet Data",
    description:
        "Import from CSV or TSV files with flexible column mapping for source content and translations",
    icon: Table,
    component: SpreadsheetImporterForm,
    supportedExtensions: ["csv", "tsv"],
    supportedMimeTypes: ["text/csv", "text/tab-separated-values", "application/csv"],
    tags: ["Structured", "Data", "Translation"],
    enabled: true,
};

export { SpreadsheetImporterForm };
