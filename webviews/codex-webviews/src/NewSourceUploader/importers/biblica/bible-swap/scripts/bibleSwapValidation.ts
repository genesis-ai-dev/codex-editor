/**
 * Runs the real export-time Bible Swap over every study volume of a language
 * and scores the result with the external validator's own rules
 * (`validatorHarness.ts`), so a test can assert on the same issue list the
 * batch validation report shows.
 */
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import {
    applyBibleSwapWithShared,
    buildBibleSwapSharedResources,
    deserializeVersificationPlan,
    type BibleSwapMappingDocument,
} from "../index";
import {
    parseValidatorStory,
    runValidatorAnalysis,
    VALIDATOR_STATUS_LABELS,
    type ValidatorAnalysis,
    type ValidatorResult,
} from "./validatorHarness";

const TEST_FILES_ROOT =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing";
export const STUDY_DIR = `${TEST_FILES_ROOT}/English IDML`;
const BIBLE_ROOT = `${TEST_FILES_ROOT}/BIBLE Files`;

export interface VolumePair {
    volume: string;
    studyFile: string;
    bibleFile: string;
}

export interface LanguageFixture {
    language: string;
    bibleDir: string;
    volumes: readonly VolumePair[];
}

/**
 * Volume layout shared by every language whose Bible ships as six IDMLs.
 * `overrides` covers Bibles that ship a volume under a different file name.
 */
function standardVolumes(
    suffix: string,
    overrides: Record<string, string> = {}
): readonly VolumePair[] {
    const pairs: VolumePair[] = [
        { volume: "GEN-DEU", studyFile: "GEN-DEU.idml", bibleFile: `01GEN-05DEU_${suffix}.idml` },
        { volume: "JOS-EST", studyFile: "JOS-EST.idml", bibleFile: `06JOS-17EST_${suffix}.idml` },
        { volume: "JOB-SNG", studyFile: "JOB-SNG.idml", bibleFile: `18JOB-22SNG_${suffix}.idml` },
        { volume: "ISA-MAL", studyFile: "ISA-MAL.idml", bibleFile: `23ISA-39MAL_${suffix}.idml` },
        { volume: "MAT-JOHN", studyFile: "MAT-JOHN.idml", bibleFile: `40MAT-43JHN_${suffix}.idml` },
        { volume: "ACT-REV", studyFile: "ACT-REV.idml", bibleFile: `44ACT-66REV_${suffix}.idml` },
    ];
    return pairs.map((pair) =>
        overrides[pair.volume] ? { ...pair, bibleFile: overrides[pair.volume] } : pair
    );
}

export const LANGUAGE_FIXTURES: Record<string, LanguageFixture> = {
    portuguese: {
        language: "portuguese",
        bibleDir: `${BIBLE_ROOT}/Portuguese Full Bible`,
        volumes: standardVolumes("portuguese"),
    },
    marathi: {
        language: "marathi",
        bibleDir: `${BIBLE_ROOT}/NEW/Marathi Full Bible`,
        volumes: standardVolumes("marathi"),
    },
    french: {
        language: "french",
        bibleDir: `${BIBLE_ROOT}/NEW/French Full Bible`,
        volumes: standardVolumes("french", {
            "MAT-JOHN": "40MAT_43JHN_french.idml",
        }),
    },
    hindi: {
        language: "hindi",
        bibleDir: `${BIBLE_ROOT}/NEW/Hindi Full Bible`,
        volumes: standardVolumes("hindi", {
            "GEN-DEU": "01GEN_05DEU_hindi.idml",
            "MAT-JOHN": "40MAT_43JHN_hindi.idml",
        }),
    },
};

export const PORTUGUESE_VOLUMES = LANGUAGE_FIXTURES.portuguese.volumes;
export const MARATHI_VOLUMES = LANGUAGE_FIXTURES.marathi.volumes;
export const FRENCH_VOLUMES = LANGUAGE_FIXTURES.french.volumes;
export const HINDI_VOLUMES = LANGUAGE_FIXTURES.hindi.volumes;

export function languageFixture(language: string): LanguageFixture {
    const fixture = LANGUAGE_FIXTURES[language];
    if (!fixture) throw new Error(`No Bible Swap fixture registered for "${language}"`);
    return fixture;
}

const MAPPING_ROOT = path.join(__dirname, "..", "language-mappings");

export function volumePaths(
    pair: VolumePair,
    language = "portuguese"
): { study: string; bible: string } {
    return {
        study: path.join(STUDY_DIR, pair.studyFile),
        bible: path.join(languageFixture(language).bibleDir, pair.bibleFile),
    };
}

export function volumeFilesExist(pair: VolumePair, language = "portuguese"): boolean {
    const { study, bible } = volumePaths(pair, language);
    return fs.existsSync(study) && fs.existsSync(bible);
}

/** The validator only reads the largest story, so that is what we swap. */
export async function loadMainStory(idmlPath: string): Promise<string> {
    const zip = await JSZip.loadAsync(new Uint8Array(fs.readFileSync(idmlPath)));
    let xml = "";
    for (const name of Object.keys(zip.files)) {
        if (!name.startsWith("Stories/") || !name.endsWith(".xml")) continue;
        const text = await zip.file(name)!.async("string");
        if (text.length > xml.length) xml = text;
    }
    return xml;
}

export function mappingFilePath(language: string, volume: string): string {
    return path.join(MAPPING_ROOT, language, `${volume}.mapping.json`);
}

export function loadMappingDocument(
    language: string,
    volume: string
): BibleSwapMappingDocument {
    return JSON.parse(
        fs.readFileSync(mappingFilePath(language, volume), "utf-8")
    ) as BibleSwapMappingDocument;
}

export interface VolumeValidation {
    volume: string;
    analysis: ValidatorAnalysis;
    studyXml: string;
    bibleXml: string;
    exportXml: string;
}

/**
 * Mirrors `exportHandler` → `biblicaExporter` → `applyBibleSwapWithShared`:
 * precomputed plan, language strategy (mode + chapter-block flags + refinements).
 */
export async function swapAndValidateVolume(
    pair: VolumePair,
    language = "portuguese"
): Promise<VolumeValidation> {
    const { study, bible } = volumePaths(pair, language);
    const studyXml = await loadMainStory(study);
    const bibleXml = await loadMainStory(bible);

    const plan = deserializeVersificationPlan(
        loadMappingDocument(language, pair.volume).plan
    );
    const shared = buildBibleSwapSharedResources(bibleXml, "structure", language);
    const { xml: exportXml } = applyBibleSwapWithShared(
        studyXml,
        bibleXml,
        "structure",
        shared,
        { versificationPlan: plan, language, studyVolume: pair.volume }
    );

    const analysis = runValidatorAnalysis(
        parseValidatorStory(studyXml),
        parseValidatorStory(bibleXml),
        parseValidatorStory(exportXml)
    );

    return { volume: pair.volume, analysis, studyXml, bibleXml, exportXml };
}

export function issueKey(r: ValidatorResult): string {
    return `${r.book} ${r.chapter}:${r.verse}`;
}

export function summarizeIssues(analysis: ValidatorAnalysis): string {
    const byStatus = new Map<string, string[]>();
    for (const r of analysis.issues) {
        const label = VALIDATOR_STATUS_LABELS[r.status];
        byStatus.set(label, [...(byStatus.get(label) ?? []), issueKey(r)]);
    }
    return [...byStatus.entries()]
        .map(([label, keys]) => `  ${label} (${keys.length}): ${keys.join(", ")}`)
        .join("\n");
}
