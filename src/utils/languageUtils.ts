import { LanguageMetadata, ScriptDirection } from "codex-types";
import isoLanguageData from "./languages.json";

interface RawLanguageEntry {
    Id: string;
    Part1?: string;
    Part2b?: string;
    Part2t?: string;
    Scope: string;
    Language_Type: string;
    Ref_Name: string;
    Comment: string | null;
    ScriptDirection: "ltr" | "rtl";
}

const scopeMap: Record<string, string> = {
    I: "individual",
    M: "macrolanguage",
    S: "special",
};

const typeMap: Record<string, string> = {
    A: "ancient",
    C: "constructed",
    E: "extinct",
    H: "historical",
    L: "living",
    S: "special",
};

export const LanguageCodes: LanguageMetadata[] = (isoLanguageData as RawLanguageEntry[]).map(
    (line) => ({
        tag: line.Id,
        name: {
            [line.Part1 ?? ""]: line.Ref_Name,
        },
        iso2b: line.Part2b,
        iso2t: line.Part2t,
        iso1: line.Part1,
        scope: scopeMap[line.Scope] || line.Scope,
        type: typeMap[line.Language_Type] || line.Language_Type,
        refName: line.Ref_Name,
        comment: line.Comment ?? undefined,
        scriptDirection:
            line.ScriptDirection === "rtl" ? ScriptDirection.RTL : ScriptDirection.LTR,
    })
);

export type { LanguageMetadata };
