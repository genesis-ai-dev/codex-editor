# Bible Swap — Portuguese structure-swap findings

Report analyzed: `bible-swap-validation_2026-07-06T12-34-57.md` (Portuguese, mode `structure`).

Files inspected on disk:
- Study: `automated_app/english_bsb/*.idml`
- Bible: `automated_app/translated_bible/portuguese/*.idml`
- Export: `automated_app/exported/portuguese/*_bible-swap.idml`

Method: unzipped each IDML, indexed `meta:bk` / `meta:c` / `meta:v` markers and `[No character style]` prose per book/chapter/verse, and compared **export vs bible vs study** verse-by-verse to see exactly what wrong text landed where.

## Summary of remaining issues

| File | Acc | Issues | Dominant cause |
|------|----:|-------:|----------------|
| ACT-REV | 99% | 51 | Chapter-boundary bleed (1CO 10→11, 2CO 1→2, EPH…) |
| GEN-DEU | 100% | 4 | Chapter-opening boundary paragraph (`p_dc1`) |
| ISA-MAL | 100% | 22 | **HAB 3 regression** (new) + LAM 1:22 acrostic |
| JOB-SNG | 100% | 6 | Isolated boundary / acrostic verses |
| JOS-EST | 99% | 79 | NEH 7→8 census bleed (biggest single cluster) |
| MAT-JOHN | 100% | 18 | JHN 8 boundary bleed |

The overwhelming majority of remaining defects are **NOT** caused by bad translated-bible structure or bad English BSB structure. They are caused by the **swap logic mishandling chapter-boundary paragraphs** when the *previous* chapter is split into multiple spans by study note blocks. Two exceptions (genuine structure/versification mismatches) are called out below.

---

## Finding 1 — Chapter-boundary bleed: previous chapter's tail is pasted into the next chapter (PRIMARY cause)

**Affected:** 1CO 11:14–33, 2CO 2:12 + 2:18–24 (extra), EPH 5:17–31, EPH 6, NEH 8:4–72, JHN 8:37–52, and most isolated "Wrong Text" at `X:1`.

**Evidence (1CO 11, ACT-REV):**
- Export `1CO|11|14` = "Por isso, meus amados irmãos, fujam da idolatria" → this is the Portuguese of **1CO 10:14**.
- Export `1CO|11|23` = "'Tudo me é permitido'…" → **1CO 10:23**.
- Export `1CO|11|26` = "do Senhor é a terra…" → **1CO 10:26**.
- Verses 11:2–13 and 11:27–30 are correct; only the ranges pulled from chapter 10 are wrong.

**Evidence (NEH 8, JOS-EST):**
- Export `NEH|8|4` = "Ora, a cidade era grande e espaçosa" → **NEH 7:4** (start of the census).
- Export `NEH|8|6` = "Estes são os homens da província" → **NEH 7:6** (census list).
- The census (NEH 7 = 73 verses) overflows into NEH 8, producing the entire `NEH 8:19–72` "Extra in Export" block.

**Evidence (2CO 2, ACT-REV):**
- Export `2CO|2|12` = "Disto temos orgulho: a nossa consciência" → **2CO 1:12**.
- Export `2CO|2|23`, `2:24` = "Invoco a Deus como testemunha…" → **2CO 1:23–24** (the `2:18–23` extras).

**Mechanism (confirmed by dumping export paragraph structure):**
The Portuguese 1CO 11:1 text ("Sejam meus imitadores…") appears **4 times** in the export's main story. The study chapter boundary is a single physical `text:p_dc2` / `text:p_dc1` paragraph that holds **both** the closing verse of chapter N (e.g. 10:33) **and** the opening of chapter N+1 (11:1). When chapter N is *also* split by `intro:*` study-note blocks into several spans, the boundary coalesce/splice step:
1. duplicates the boundary paragraph, and
2. leaves chapter N's later spans (e.g. 10:14–33) positioned *after* the `meta:c` marker of chapter N+1.

Because the export verse index is **first-occurrence-wins**, those mis-labeled chapter-N paragraphs are read as chapter N+1, so 11:14–33 return chapter-10 text and 8:4–72 return chapter-7 text.

**This is a swap-logic bug**, not a file problem: study and bible verse counts for these chapters match (1CO 11 = 34/34; 2CO 2 = 18/18; both structures line up paragraph-for-paragraph). The GEN-DEU EXO 35→36 fix handled one shape of this; the `p_dc1`/`p_dc2` boundary where the previous chapter has **note-split spans + an internal `head:s*`** is not yet handled.

Isolated `X:1` "Wrong Text" (GEN 29:14, GEN 35:22, EXO 7:1, EXO 8:1, 1SA 4:1/13:1/14:1/25:1, 2SA 19:8, 1KI 19:9, 2KI 5:19/24:20, NEH 7:73, ACT 8:1/9:19/10:23/12:19, MRK 6:6, JHN 19:16) are the **single-paragraph** version of the same boundary problem — e.g. study EXO 8 opens with `text:p_dc1 cM=7,8 v=25,1,2,3,4` (7:25 + 8:1–4 in one paragraph).

---

## Finding 2 — HAB 3 regression introduced by `appendRemoveVerseSplices` (NEW, must revert/guard)

**Affected:** HAB 3:1–18 now "Missing from Export" (was only HAB 3:1 "unchanged English" before). This is a *regression* from the in-progress `appendRemoveVerseSplices` change in `structureSwap.ts`.

**Evidence:**
- Study HAB 3 opens with a `head:d_dc1` superscription paragraph that carries **both** `meta:c 3` **and** verse 1 ("This is a prayer of Habakkuk…").
- The Portuguese bible does not index a `HAB|3|1` *verse* (its superscription is a `head:d` subheader, not a `meta:v`), so the plan marks study `HAB|3|1` as `action: "remove"`.
- `appendRemoveVerseSplices` wiped that whole paragraph — **including the `meta:c 3` chapter marker**.
- Result: HAB 3:2–18 are correctly swapped to Portuguese in the export, but with no chapter-3 marker they stay labeled **chapter 2**, so the validator can't find HAB 3:2–18 → "Missing".

**Fix direction:** `appendRemoveVerseSplices` must never wipe a paragraph that carries a `meta:c` chapter marker (or must re-emit the marker). Better: treat a study-only superscription verse as **replace with the bible's superscription heading**, not remove. Recommend reverting the remove-verse splice for now (it only targeted HAB 3:1) and handling the superscription as a heading swap.

---

## Finding 3 — LAM 1:22 acrostic verse still dropped

**Affected:** LAM 1:22 "Missing from Export".

**Evidence:** Bible `LAM|1|22` = "א Álef com a nuvem da sua ira…" — an **acrostic** verse (Hebrew letter heading prefix) in poetry. The `cv:v`-opener handling added to `surgicalSwap`/`chapterBlocks` fixed the synthetic case, but the real Portuguese LAM 1:22 combines an acrostic `head:qa`-style letter prefix with the poetry `cv:v`/`meta:v` split, and the span/slice for verse 22 is still not captured. Verse-count is fine (study 22 / bible 22); this is a slice-extraction edge case for acrostic + poetry lead-in at chapter end.

---

## Finding 4 — Genuine translated-bible vs study versification/structure mismatches (small set)

These are **not** swap bugs; the files legitimately differ:

- **"Should Be Added" trailing verses** — RUT 4:22 (bible 20 vs study 22… bible ends earlier), HAB 3:19: the bible has a trailing verse the study lacks (or vice-versa). These need the chapter-insert/append path to run *after* the boundary fix.
- **SNG 1:4, 5:1, 5:2, 6:13, 7:9, 8:5; JON 1:2, 2:2; JER 38:28** — Song of Songs and Jonah use heavy speaker-label / poetry paragraphing where study and Portuguese assign the same prose to slightly different verse slots (versification differences), producing "Wrong Text" / "Added (Wrong Text)". Lower priority; verify individually before changing logic.

---

## Recommended fix order

1. **Revert / guard `appendRemoveVerseSplices`** so it never removes a paragraph holding a `meta:c` marker (fixes the HAB 3 regression, −18 issues on ISA-MAL). *(regression — do first)*
2. **Chapter-boundary bleed** (Finding 1): stop duplicating the `p_dc1`/`p_dc2` boundary paragraph and keep the previous chapter's note-split spans bound to the previous chapter number during coalesce. Highest impact (fixes NEH 8 cluster ≈ 60 issues, 1CO/2CO/EPH ≈ 45, JHN 8 ≈ 16, plus the isolated `X:1` cases).
3. **LAM 1:22** acrostic + poetry slice extraction at chapter end.
4. **Trailing inserts** (RUT 4:22, HAB 3:19) — re-verify after (1)/(2).
5. **SNG/JON/JER** versification cases — inspect individually; likely genuine file differences.

## Reproduction notes

Root causes were verified by unzipping the export/bible/study IDMLs and comparing the `meta:c`/`meta:v` marker streams and `[No character style]` prose per verse. Key tells:
- Wrong text at `chapter N:v` matches bible `chapter N-1:v` → boundary bleed (Finding 1).
- Portuguese `N:1` boundary text repeated >1× in the export story → boundary-paragraph duplication (Finding 1).
- Correctly-swapped verses labeled with the *previous* chapter number → orphaned `meta:c` (Finding 2).
