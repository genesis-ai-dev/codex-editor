import React from "react";
import { ShieldCheck } from "lucide-react";
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
    <div
        className={`mt-3 rounded-md border-2 p-3 transition-colors ${
            checked ? "border-primary bg-accent" : "border-border bg-muted/30"
        }`}
    >
        <div className="flex items-center gap-2">
            <Checkbox
                id="enforceHtmlStructure"
                checked={checked}
                onCheckedChange={(val) => onCheckedChange(!!val)}
            />
            <ShieldCheck className={`h-4 w-4 ${checked ? "text-primary" : "text-muted-foreground"}`} />
            <Label htmlFor="enforceHtmlStructure" className="font-medium cursor-pointer text-foreground">
                Enforce HTML structure (round-trip)
            </Label>
        </div>
        <p className="ml-12 mt-1 text-xs text-muted-foreground">
            Validates translated cells against source HTML structure. Mismatches are flagged during editing and export.
        </p>
    </div>
);

export default EnforceStructureCheckbox;
