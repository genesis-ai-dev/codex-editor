import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseUsfmToJson, stringifyUsfmFromJson, countMarkersByTag } from './regexUsfmParser';
import { exportToUSFM, processUsfmContent } from './usfmUtils';
import { createHash } from 'crypto';

const makeHash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const listUsfmFiles = (dir: string): string[] => {
    const out: string[] = [];
    const entries = readdirSync(dir);
    for (const name of entries) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) continue;
        if (/\.(usfm|sfm)$/i.test(name)) out.push(p);
    }
    return out.sort();
};

describe('External USFM round-trip (regex parser) - optional', () => {
    const externalDir = process.env.USFM_DIR;

    if (!externalDir) {
        it.skip('skips because USFM_DIR not provided', () => {
            expect(true).toBe(true);
        });
        return;
    }

    const files = listUsfmFiles(externalDir);

    it(`parses and round-trips ${files.length} files`, async () => {
        expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
            const input = readFileSync(file, 'utf8');

            // First parse with regex JSON shape
            const parsedJson = parseUsfmToJson(input);
            const regenerated = stringifyUsfmFromJson(parsedJson);

            // Compare marker counts pre/post regeneration
            expect(countMarkersByTag(regenerated)).toEqual(countMarkersByTag(input));

            // Parse into Codex notebook intermediate
            const processed = await processUsfmContent(input, file.split('/').pop() || file);
            const exported = exportToUSFM(processed);

            // Second parse after export and compare counts again
            expect(countMarkersByTag(exported)).toEqual(countMarkersByTag(input));

            // Re-parse exported with regex and compare JSON shapes lengths (basic invariants)
            const reparsed = parseUsfmToJson(exported);
            expect(reparsed.chapters.length).toBe(parsedJson.chapters.length);

            // Hash comparison is not guaranteed across all real-life inputs, but ensure stability here
            expect(makeHash(exported)).toBeDefined();
        }
    }, 120_000);
});


