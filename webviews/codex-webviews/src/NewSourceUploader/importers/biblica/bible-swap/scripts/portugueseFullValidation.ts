/**
 * Runs the real export-time Bible Swap over every Portuguese study volume and
 * scores the result with the external validator's own rules
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
export const PORTUGUESE_BIBLE_DIR = `${TEST_FILES_ROOT}/BIBLE Files/Portuguese Full Bible`;

export interface VolumePair {
    volume: string;
    studyFile: string;
    bibleFile: string;
}

export const PORTUGUESE_VOLUMES: readonly VolumePair[] = [
    { volume: "GEN-DEU", studyFile: "GEN-DEU.idml", bibleFile: "01GEN-05DEU_portuguese.idml" },
    { volume: "JOS-EST", studyFile: "JOS-EST.idml", bibleFile: "06JOS-17EST_portuguese.idml" },
    { volume: "JOB-SNG", studyFile: "JOB-SNG.idml", bibleFile: "18JOB-22SNG_portuguese.idml" },
    { volume: "ISA-MAL", studyFile: "ISA-MAL.idml", bibleFile: "23ISA-39MAL_portuguese.idml" },
    { volume: "MAT-JOHN", studyFile: "MAT-JOHN.idml", bibleFile: "40MAT-43JHN_portuguese.idml" },
    { volume: "ACT-REV", studyFile: "ACT-REV.idml", bibleFile: "44ACT-66REV_portuguese.idml" },
];

const MAPPING_ROOT = path.join(__dirname, "..", "language-mappings");

export function volumePaths(pair: VolumePair): { study: string; bible: string } {
    return {
        study: path.join(STUDY_DIR, pair.studyFile),
        bible: path.join(PORTUGUESE_BIBLE_DIR, pair.bibleFile),
    };
}

export function volumeFilesExist(pair: VolumePair): boolean {
    const { study, bible } = volumePaths(pair);
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

export function loadMappingDocument(
    language: string,
    volume: string
): BibleSwapMappingDocument {
    return JSON.parse(
        fs.readFileSync(path.join(MAPPING_ROOT, language, `${volume}.mapping.json`), "utf-8")
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
    const { study, bible } = volumePaths(pair);
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
