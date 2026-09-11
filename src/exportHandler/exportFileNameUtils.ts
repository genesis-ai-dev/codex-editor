import * as vscode from "vscode";
import { basename, extname } from "path";

/**
 * ISO 639-3 tags → ISO 639-1, for languages that have a 2-letter code.
 * Used to recognize source-file suffixes like `_en` when the project stores `eng`.
 */
const TAG_TO_ISO1: Record<string, string> = {
    eng: "en",
    spa: "es",
    fra: "fr",
    fre: "fr",
    deu: "de",
    ger: "de",
    por: "pt",
    ita: "it",
    nld: "nl",
    dut: "nl",
    rus: "ru",
    zho: "zh",
    chi: "zh",
    arb: "ar",
    ara: "ar",
    hin: "hi",
    swa: "sw",
    ind: "id",
    tgl: "tl",
    kor: "ko",
    jpn: "ja",
    vie: "vi",
    tha: "th",
    tur: "tr",
    pol: "pl",
    ukr: "uk",
    ces: "cs",
    cze: "cs",
    ron: "ro",
    rum: "ro",
    hun: "hu",
    swe: "sv",
    dan: "da",
    nor: "no",
    nob: "nb",
    nno: "nn",
    fin: "fi",
    ell: "el",
    gre: "el",
    heb: "he",
    urd: "ur",
    ben: "bn",
    tam: "ta",
    tel: "te",
    mar: "mr",
    mal: "ml",
    kan: "kn",
    pan: "pa",
    guj: "gu",
    amh: "am",
    yor: "yo",
    ibo: "ig",
    hau: "ha",
    zul: "zu",
    afr: "af",
    cat: "ca",
    eus: "eu",
    glg: "gl",
    slk: "sk",
    slo: "sk",
    slv: "sl",
    hrv: "hr",
    srp: "sr",
    bul: "bg",
    lit: "lt",
    lav: "lv",
    est: "et",
    isl: "is",
    gle: "ga",
    cym: "cy",
    msa: "ms",
    may: "ms",
    fil: "tl",
    lat: "la",
};

const ISO1_TO_TAG: Record<string, string> = Object.fromEntries(
    Object.entries(TAG_TO_ISO1).map(([tag, iso1]) => [iso1, tag])
);

const WELL_KNOWN_LANG_TOKENS = new Set([
    ...Object.keys(TAG_TO_ISO1),
    ...Object.values(TAG_TO_ISO1),
]);

export type ProjectLanguageLike = {
    tag?: string;
    iso1?: string;
    iso2t?: string;
    iso2b?: string;
    refName?: string;
};

export function sanitizeFileComponent(input: string): string {
    return input
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/_+/g, "_");
}

function addCodeAndParts(codes: Set<string>, raw?: string): void {
    if (!raw) return;
    const sanitized = sanitizeFileComponent(String(raw).toLowerCase());
    if (!sanitized || sanitized === "custom" || sanitized === "lang") return;
    codes.add(sanitized);
    const primary = sanitized.split("-")[0];
    if (primary && primary !== sanitized) {
        codes.add(primary);
    }
}

/** Filename-friendly language code: ISO 639-3 tag (e.g. `luo`), falling back to iso1 / name. */
export function languageFileCode(lang: ProjectLanguageLike | undefined): string {
    const raw = lang?.tag || lang?.iso1 || lang?.iso2t || lang?.refName || "lang";
    return sanitizeFileComponent(String(raw).toLowerCase()) || "lang";
}

/** All codes that might appear as a `_lang` token for this language (`eng` and `en`, etc.). */
export function languageCodeAliases(lang: ProjectLanguageLike | undefined): string[] {
    const codes = new Set<string>();
    addCodeAndParts(codes, lang?.tag);
    addCodeAndParts(codes, lang?.iso1);
    addCodeAndParts(codes, lang?.iso2t);
    addCodeAndParts(codes, lang?.iso2b);

    for (const code of [...codes]) {
        const iso1 = TAG_TO_ISO1[code];
        if (iso1) codes.add(iso1);
        const tag = ISO1_TO_TAG[code];
        if (tag) codes.add(tag);
    }

    return [...codes];
}

export function getProjectExportLanguageCodes(): {
    targetCode: string;
    sourceAliases: string[];
} {
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const target = projectConfig.get<ProjectLanguageLike>("targetLanguage") || {};
    const source = projectConfig.get<ProjectLanguageLike>("sourceLanguage") || {};
    return {
        targetCode: languageFileCode(target),
        sourceAliases: languageCodeAliases(source),
    };
}

export function getTargetLanguageCode(): string {
    return getProjectExportLanguageCodes().targetCode;
}

/**
 * Rewrites an export basename to use the project's target language instead of
 * the source language (typically `_en` from English source files). Does not
 * append a timestamp.
 *
 * `Some_project_120_en` + target `luo` → `Some_project_120_luo`
 */
export function rewriteExportBaseName(
    baseName: string,
    targetCode: string,
    sourceAliases: string[] = []
): string {
    const sanitizedTarget = sanitizeFileComponent(targetCode.toLowerCase()) || "lang";
    const aliasSet = new Set(
        sourceAliases
            .map((alias) => sanitizeFileComponent(alias.toLowerCase()))
            .filter((alias) => alias && alias !== sanitizedTarget)
    );

    const sanitizedBase = sanitizeFileComponent(baseName);
    const tokens = sanitizedBase.split("_").filter((token) => token.length > 0);
    if (tokens.length === 0) {
        return sanitizedTarget;
    }

    const isReplaceableLangToken = (token: string): boolean => {
        const lower = token.toLowerCase();
        if (lower === sanitizedTarget) return false;
        if (aliasSet.has(lower)) return true;
        // Fallback: original assets are often named `*_en` even when source
        // language metadata is missing. Never replace a lone token (e.g. `MAT`).
        return tokens.length > 1 && WELL_KNOWN_LANG_TOKENS.has(lower);
    };

    for (let i = tokens.length - 1; i >= 0; i--) {
        if (isReplaceableLangToken(tokens[i]!)) {
            tokens[i] = sanitizedTarget;
            return tokens.join("_");
        }
    }

    if (tokens[tokens.length - 1]?.toLowerCase() !== sanitizedTarget) {
        tokens.push(sanitizedTarget);
    }
    return tokens.join("_");
}

export function toExportFileBaseName(
    originalName: string,
    targetCode?: string,
    sourceAliases?: string[]
): string {
    const codes =
        targetCode !== undefined
            ? { targetCode, sourceAliases: sourceAliases ?? [] }
            : getProjectExportLanguageCodes();
    const fileName = basename(originalName);
    const originalExt = extname(fileName);
    const base = originalExt ? fileName.slice(0, -originalExt.length) : fileName;
    return rewriteExportBaseName(base, codes.targetCode, codes.sourceAliases);
}

/**
 * Builds an export filename from an original/notebook name: swap the source
 * language token for the project target language, keep the project/asset
 * prefix, and do not add a timestamp.
 */
export function toExportFileName(
    originalName: string,
    outputExtension: string,
    targetCode?: string,
    sourceAliases?: string[]
): string {
    const ext = outputExtension.startsWith(".") ? outputExtension : `.${outputExtension}`;
    return `${toExportFileBaseName(originalName, targetCode, sourceAliases)}${ext}`;
}
