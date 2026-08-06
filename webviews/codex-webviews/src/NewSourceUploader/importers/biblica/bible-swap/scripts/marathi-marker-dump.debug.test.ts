/** Dumps raw verse-marker `<Content>` text around the Marathi merged verses. */
import { describe, it } from "vitest";
import { MARATHI_VOLUMES, loadMainStory, volumePaths } from "./bibleSwapValidation";

describe("Marathi verse marker dump", () => {
    for (const volume of ["JOS-EST", "ACT-REV"]) {
        it(volume, async () => {
            const pair = MARATHI_VOLUMES.find((v) => v.volume === volume)!;
            const bibleXml = await loadMainStory(volumePaths(pair, "marathi").bible);

            const markers = [
                ...bibleXml.matchAll(
                    /<CharacterStyleRange[^>]*AppliedCharacterStyle="[^"]*(?:meta%3av|meta:v|cv%3av|cv:v)[^"]*"[\s\S]*?<\/CharacterStyleRange>/g
                ),
            ];
            const odd = markers
                .map((m) => {
                    const text = [...m[0].matchAll(/<Content>([\s\S]*?)<\/Content>/g)]
                        .map((c) => c[1])
                        .join("");
                    return { text, style: /AppliedCharacterStyle="([^"]+)"/.exec(m[0])?.[1] ?? "" };
                })
                .filter((m) => /\d/.test(m.text) && /[^0-9\s:.]/.test(m.text.trim()));

            const seen = new Set<string>();
            for (const m of odd) {
                const key = `${m.style}::${m.text}`;
                if (seen.has(key)) continue;
                seen.add(key);
                console.log(
                    `${m.style} :: ${JSON.stringify(m.text)} :: codes=[${[...m.text]
                        .map((c) => c.charCodeAt(0))
                        .join(",")}]`
                );
            }
            console.log(`total markers=${markers.length} non-plain=${odd.length} unique=${seen.size}`);
        }, 600000);
    }
});
