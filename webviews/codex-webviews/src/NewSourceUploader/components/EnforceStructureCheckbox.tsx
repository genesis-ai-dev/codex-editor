import React from "react";
import { Checkbox } from "../../components/ui/checkbox";
import { Label } from "../../components/ui/label";

interface EnforceStructureCheckboxProps {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}

const EnforceStructureCheckbox: React.FC<EnforceStructureCheckboxProps> = ({
    checked,
    onCheckedChange,
}) => (
    <div className="mt-3 rounded-md border border-border p-3">
        <div className="flex items-center gap-2">
            <Checkbox
                id="enforceHtmlStructure"
                checked={checked}
                onCheckedChange={(val) => onCheckedChange(!!val)}
            />
            <Label htmlFor="enforceHtmlStructure" className="font-medium">
                Round-trip enforce structure
            </Label>
        </div>
        <p className="ml-6 mt-1 text-xs text-muted-foreground">
            When enabled, translated cells will be validated against the source HTML structure.
            Mismatches will be flagged as errors during editing and warned about during export.
        </p>
    </div>
);

export default EnforceStructureCheckbox;
