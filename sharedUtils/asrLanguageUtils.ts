/**
 * ASR language-utility functions
 * ------------------------------
 *
 * Pure helpers (no `vscode` imports → unit-testable, usable from both the
 * extension host and the webviews) that:
 *
 *   1. **Resolve** a project's language metadata into an OmniASR-compatible
 *      `{iso639_3}_{Script}` code (or decide we should send no code, letting
 *      the server transcribe without language conditioning).
 *   2. **Label** an OmniASR code with a friendly display name suitable for the
 *      post-transcription badge (e.g. `swh_Latn` → "Swahili").
 *
 * Why this lives in `sharedUtils/`
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Both the extension host (`src/providers/...`) and the webviews
 * (`webviews/.../CodexCellEditor`) need it: the host builds the `asrConfig`
 * payload from project settings, and the webview renders the badge after a
 * transcription completes.
 */

import {
    OMNI_ASR_SUPPORTED_LANGS,
    OMNI_ASR_SUPPORTED_LANG_SET,
} from "./omniAsrSupportedLangs";
import { OMNI_ASR_DEFAULT_SCRIPTS } from "./omniAsrDefaultScripts";
import { OMNI_ASR_FRIENDLY_NAMES } from "./omniAsrFriendlyNames";

/**
 * Minimal shape of the project's language metadata that we consume here.
 * Matches `codex-types`'s `LanguageMetadata` but we restate it so this file
 * doesn't pull `codex-types` (and its transitive deps) into the webview
 * bundle.
 */
export type AsrLanguageMetaInput = {
    tag?: string;
    iso1?: string;
    iso2t?: string;
    iso2b?: string;
    refName?: string;
};

/**
 * Macrolanguage → individual-language remaps used when the project's tag
 * names a macrolanguage that OmniASR doesn't serve directly. Each pair maps
 * a macro ISO 639-3 to the individual ISO 639-3 that OmniASR actually
 * supports for the most widely-spoken variety. Sources:
 *   - SIL macrolanguage mappings (iso-639-3-macrolanguages.tab)
 *   - cross-checked against `OMNI_ASR_SUPPORTED_LANGS`
 *
 * Add only when (a) the macro is genuinely not in OmniASR's set and (b) the
 * "right" individual is unambiguous.
 */
const MACRO_TO_INDIVIDUAL: Readonly<Record<string, string>> = {
    swa: "swh", // Swahili → Coastal Swahili (Kenya/Tanzania majority)
    ara: "arb", // Arabic → Modern Standard Arabic
    msa: "zsm", // Malay → Standard Malay
    zho: "cmn", // Chinese → Mandarin
    ori: "ory", // Oriya → Odia
    est: "ekk", // Estonian → Standard Estonian
    sqi: "als", // Albanian → Tosk Albanian
    kur: "kmr", // Kurdish → Northern Kurdish (largest speaker base)
    nor: "nob", // Norwegian → Bokmål
    oji: "ojb", // Ojibwa → Northwestern Ojibwa
};

/** ISO 639-1 (2-letter) → ISO 639-3 (3-letter). Common languages only; the
 * project usually carries `iso2t` directly so this is just a fallback. */
const ISO1_TO_ISO3: Readonly<Record<string, string>> = {
    en: "eng", fr: "fra", es: "spa", de: "deu", pt: "por", it: "ita",
    nl: "nld", ru: "rus", zh: "cmn", ja: "jpn", ko: "kor", ar: "arb",
    sw: "swh", ur: "urd", hi: "hin", bn: "ben", id: "ind", tr: "tur",
    th: "tha", vi: "vie", uk: "ukr", pl: "pol", fa: "pes", he: "heb",
};

/**
 * Pull the ISO 639-3 base + optional Script subtag out of a project's
 * language metadata, normalizing macrolanguages to OmniASR-served
 * individuals. Returns `undefined` if we can't recover a 3-letter code.
 */
function extractBaseAndScript(
    meta: AsrLanguageMetaInput | undefined
): { base: string; explicitScript?: string; } | undefined {
    if (!meta) return undefined;

    // BCP-47-ish tag is the richest source: e.g. "swh", "ur-Arab", "zh-Hans".
    const tag = (meta.tag || "").trim();
    let base = "";
    let explicitScript: string | undefined;

    if (tag) {
        const [primary, ...subtags] = tag.split(/[-_]/);
        const lowered = (primary || "").toLowerCase();
        if (lowered.length === 3) {
            base = lowered;
        } else if (lowered.length === 2) {
            base = ISO1_TO_ISO3[lowered] ?? "";
        }
        // Script subtags are exactly 4 chars, title-case (Latn, Arab, Cyrl, ...).
        const script = subtags.find((s) => s.length === 4);
        if (script) {
            explicitScript = script.charAt(0).toUpperCase() + script.slice(1).toLowerCase();
        }
    }

    if (!base) {
        base = (meta.iso2t || meta.iso2b || "").toLowerCase();
    }
    if (!base) {
        const i1 = (meta.iso1 || "").toLowerCase();
        base = ISO1_TO_ISO3[i1] ?? "";
    }
    if (!base) return undefined;

    base = MACRO_TO_INDIVIDUAL[base] ?? base;
    return { base, explicitScript };
}

/**
 * `scriptPref` is what the user picked in the Script advanced setting.
 *
 *   - `"auto"`     → "best guess" (our default). Pick the script using
 *                    `OMNI_ASR_DEFAULT_SCRIPTS`, falling back to Latin then
 *                    the sole supported script.
 *   - `"latin"`    → force Latin script when supported, otherwise fall back
 *                    to auto behaviour.
 *   - any 4-char string (`"Arab"`, `"Cyrl"`, ...) → use that script.
 */
export type AsrScriptPref = "auto" | "latin" | string;

/**
 * Resolve a project's language metadata to an OmniASR-compatible
 * `{iso639_3}_{Script}` code, or return `undefined` when we can't safely pick
 * one (the caller should then omit the `lang` query param so the server
 * transcribes without language conditioning).
 *
 * Selection priority:
 *   1. Explicit `scriptPref` (4-letter ISO 15924 tag) → use as-is when
 *      `{base}_{Script}` is a supported code.
 *   2. Script encoded in the project tag (e.g. `swa-Cyrl`) → ditto.
 *   3. `scriptPref === "latin"` → Latin if supported.
 *   4. `OMNI_ASR_DEFAULT_SCRIPTS[base]` (our hand-curated "best guess").
 *   5. Latin if supported.
 *   6. Sole supported script for this base.
 *   7. `undefined` (genuinely ambiguous → let the server pick).
 *
 * Future work: a per-cell script override could short-circuit step 1.
 */
export function resolveOmniAsrCode(
    meta: AsrLanguageMetaInput | undefined,
    scriptPref: AsrScriptPref = "auto"
): string | undefined {
    const extracted = extractBaseAndScript(meta);
    if (!extracted) return undefined;
    const { base, explicitScript } = extracted;

    // Find every supported script for this base.
    const supportedScripts = OMNI_ASR_SUPPORTED_LANGS
        .filter((c) => c.startsWith(`${base}_`))
        .map((c) => c.split("_")[1]);
    if (supportedScripts.length === 0) return undefined;

    const tryCode = (script: string): string | undefined => {
        const code = `${base}_${script}`;
        return OMNI_ASR_SUPPORTED_LANG_SET.has(code) ? code : undefined;
    };

    // 1. Explicit user-chosen script (4-letter custom tag from advanced setting)
    if (scriptPref && scriptPref !== "auto" && scriptPref !== "latin" && scriptPref.length === 4) {
        const normalized = scriptPref.charAt(0).toUpperCase() + scriptPref.slice(1).toLowerCase();
        const code = tryCode(normalized);
        if (code) return code;
    }

    // 2. Script encoded in the project tag
    if (explicitScript) {
        const code = tryCode(explicitScript);
        if (code) return code;
    }

    // 3. scriptPref === "latin" → Latin if supported
    if (scriptPref === "latin") {
        const code = tryCode("Latn");
        if (code) return code;
    }

    // 4. Default script for this base
    const defaultScript = OMNI_ASR_DEFAULT_SCRIPTS[base];
    if (defaultScript) {
        const code = tryCode(defaultScript);
        if (code) return code;
    }

    // 5. Latin if supported
    const latin = tryCode("Latn");
    if (latin) return latin;

    // 6. Sole supported script
    if (supportedScripts.length === 1) {
        return `${base}_${supportedScripts[0]}`;
    }

    // 7. Genuinely ambiguous
    return undefined;
}

/** Split an OmniASR code like "swh_Latn" into base + script (or return null). */
export function splitOmniAsrCode(code: string | undefined | null): { base: string; script: string; } | null {
    if (!code) return null;
    const m = /^([a-z]{2,3})_([A-Z][a-z]{3})$/.exec(code);
    if (!m) return null;
    return { base: m[1], script: m[2] };
}

/**
 * SIL `Ref_Name` values are CamelCased with no spaces (e.g. "MinNanChinese").
 * Split on case changes for natural-looking display: "Min Nan Chinese".
 */
function prettifyRefName(name: string): string {
    return name
        // Insert a space before any uppercase letter that follows a lowercase one.
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        // And before an uppercase letter that's followed by a lowercase one
        // (handles runs of acronyms like "USA").
        .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
        .trim();
}

/**
 * Friendly display name for a transcription's language badge.
 *
 * Inputs:
 *   - `serverLang`  — the code OmniASR echoed back in its response (when we
 *                     sent one). The primary source of truth.
 *   - `sentCode`    — what we asked the server to use, in case it didn't
 *                     echo (today the server only echoes when given a code).
 *   - `projectLanguageName` — `refName` of the project's target language, as
 *                             a last-ditch fallback when we know we sent the
 *                             project's code but the server omitted the echo.
 *
 * The badge returns `null` to mean "render nothing" (we have no honest label).
 * The caller renders "Auto Detect" itself when in auto-detect mode and we
 * have no detected-language info, so we never lie about it here.
 */
export function labelForTranscriptionLanguage(
    serverLang: string | undefined | null,
    sentCode: string | undefined | null,
    projectLanguageName: string | undefined | null
): string | null {
    const friendly = (code: string | null | undefined): string | null => {
        const parts = splitOmniAsrCode(code);
        if (!parts) return null;
        const refName = OMNI_ASR_FRIENDLY_NAMES[parts.base];
        return refName ? prettifyRefName(refName) : null;
    };

    // 1. Server's echo is always the most truthful signal.
    const fromServer = friendly(serverLang);
    if (fromServer) return fromServer;

    // 2. If we sent a code but the server didn't echo, the server still used
    //    what we sent — show that.
    const fromSent = friendly(sentCode);
    if (fromSent) return fromSent;

    // 3. Last-ditch fallback: project language name, if any.
    return projectLanguageName ? prettifyRefName(projectLanguageName) : null;
}
