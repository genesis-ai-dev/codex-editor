/**
 * OmniASR multi-script default-script table
 * -----------------------------------------
 *
 * For each OmniASR language with **multiple supported scripts**, the script
 * we should pick by default when the user has not specified one.
 *
 * Background
 * ~~~~~~~~~~
 * OmniASR codes are `{iso639_3}_{Script}` (e.g. `urd_Arab`). Almost every
 * supported base language (1631 of 1650 unique bases) supports exactly one
 * script, so the script choice is trivial. This file only lists the 19
 * multi-script bases that need a real tiebreaker.
 *
 * Selection priority used by the resolver (`asrLanguageUtils.ts`):
 *   1. Explicit script the user typed in the advanced setting
 *   2. Script encoded in the project's language tag (e.g. `swa-Cyrl`)
 *   3. **This table** (the "best guess")
 *   4. Latin, if the language supports Latin
 *   5. Sole supported script (if only one)
 *   6. Omit `lang` (server runs without language conditioning)
 *
 * Source / rationale per entry
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * Picked using Unicode CLDR `likelySubtags.xml` (the official "if a user gives
 * me a language tag with no script, what script should I assume?" table)
 * cross-checked against modern majority usage. Macrolanguage → individual
 * remaps (e.g. swa→swh, ara→arb, zho→cmn, kur→kmr) are handled in the
 * resolver *before* lookup, so this table keys on the individual codes
 * OmniASR actually serves.
 *
 * If you adjust an entry, leave a `// ←` note explaining why.
 *
 * Multi-script bases not listed here intentionally fall through to "Latin if
 * supported, else sole script". Add an entry here only when CLDR or modern
 * majority usage clearly disagrees with that default.
 *
 * Regenerating
 * ~~~~~~~~~~~~
 * To rediscover which bases need entries (after a model update changes the
 * supported set):
 *
 *   curl -s "https://genesis-ai-dev--codex-asr-serve.modal.run/languages" \
 *     | python3 -c "
 *   import json, sys
 *   d = json.load(sys.stdin)
 *   bases = {}
 *   for l in d['languages']:
 *       b, s = l.split('_')
 *       bases.setdefault(b, set()).add(s)
 *   for b, ss in sorted(bases.items()):
 *       if len(ss) > 1:
 *           print(b, sorted(ss))
 *   "
 */

export const OMNI_ASR_DEFAULT_SCRIPTS: Readonly<Record<string, string>> = {
    aze: "Latn", // Azerbaijani — modern standard (Republic of Azerbaijan) is Latin
    bcc: "Arab", // Southern Balochi — written in Arabic script
    cmn: "Hans", // Mandarin Chinese — Simplified is the more common default
    cmo: "Khmr", // Central Mnong — Khmer-script orthography (community standard)
    crk: "Cans", // Plains Cree — Canadian Aboriginal Syllabics is the traditional script
    ell: "Grek", // Greek — only one substantive script; entry exists for completeness
    gag: "Latn", // Gagauz — modern orthography is Latin
    kmr: "Latn", // Northern Kurdish — Latin (Hawar) is the predominant modern script
    lld: "Latn", // Ladin — only Latin; entry exists for completeness
    ojb: "Latn", // Northwestern Ojibwa — Latin (double-vowel) is most common in print
    rif: "Latn", // Tarifit Berber — Latin in modern publications (Tifinagh not in OmniASR)
    rmc: "Latn", // Carpathian Romani — Latin in modern orthographies
    rmy: "Latn", // Vlax Romani — Latin in modern orthographies
    tuk: "Latn", // Turkmen — modern standard (Turkmenistan) is Latin
    uig: "Arab", // Uyghur — Arabic-script (Uyghur Ereb Yëziqi) is the predominant script
    urd: "Arab", // Urdu — Arabic-script (Nastaliq) is the canonical script
    uzb: "Latn", // Uzbek — modern standard (Uzbekistan) is Latin
    wal: "Ethi", // Wolaytta — Ethiopic (Geʽez) script in modern orthographies
    yue: "Hant", // Cantonese — Traditional Chinese (Hong Kong / Guangzhou default)
};
