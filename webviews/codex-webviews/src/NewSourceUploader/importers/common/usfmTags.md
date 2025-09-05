# USFM Tags by Category

## Document Structure

-   `\id` — Book identification
-   `\usfm` — USFM version

## Chapters and Verses

-   `\c` — Chapter number
-   `\ca` — Alternate chapter number
-   `\cp` — Published chapter number
-   `\v` — Verse number
-   `\va` — Alternate verse number
-   `\vp` — Published verse number

## Paragraphs

### Identification

-   `\ide` — Character encoding
-   `\sts` — Text status
-   `\rem` — Remarks
-   `\h` — Running header text
-   `\toc#` — Book name texts
-   `\toca#` — Alternate book name texts

### Introductions

-   `\imt#` — Intro major title
-   `\is#` — Intro section heading
-   `\ip` — Intro paragraph
-   `\ipi` — Intro indented
-   `\im` — Intro margin
-   `\imi` — Intro indented margin
-   `\ipq` — Intro quote
-   `\imq` — Intro quote margin
-   `\ipr` — Intro right-aligned
-   `\ipc` — Intro centered
-   `\iq#` — Intro poetic line
-   `\ili#` — Intro list entry
-   `\ib` — Intro blank line
-   `\iot` — Intro outline title
-   `\io#` — Intro outline entry
-   `\iex` — Intro bridge text
-   `\imte` — Intro major title end
-   `\ie` — Intro end

### Titles and Sections

-   `\mt#` — Main title
-   `\mte#` — Main title
-   `\cl` — Chapter label
-   `\cd` — Chapter description
-   `\ms#` — Major section heading
-   `\mr` — Major section range
-   `\s#` — Section heading
-   `\sr` — Section range
-   `\r` — Parallel references
-   `\d` — Descriptive title
-   `\sp` — Speaker identification
-   `\sd#` — Semantic division

### Body Paragraphs

-   `\p` — Paragraph
-   `\m` — Continuation (margin)
-   `\po` — Letter opening
-   `\cls` — Letter closing
-   `\pr` — Right-aligned
-   `\pc` — Centered
-   `\pm` — Embedded paragraph
-   `\pmo` — Embedded opening
-   `\pmc` — Embedded closing
-   `\pmr` — Embedded refrain
-   `\pi#` — Indented
-   `\mi` — Indented continuation
-   `\lit` — Liturgical note
-   `\nb` — No break
-   `\b` — Blank line

**Deprecated:**

-   `\ph` — Indented hanging

### Poetry

-   `\q#` — Poetic line
-   `\qr` — Right-aligned
-   `\qc` — Centered
-   `\qa` — Acrostic heading
-   `\qm#` — Embedded poetic line
-   `\qd` — Hebrew note
-   `\b` — Blank line

### Lists

-   `\lh` — List header
-   `\li#` — List entry
-   `\lf` — List footer
-   `\lim#` — Embedded list entry

### Tables

-   `\tr` — Table row

## Characters

### Text Features

-   `\add` — Translator addition
-   `\bk` — Quoted book title
-   `\dc` — DC-only content
-   `\em` — Emphasis text
-   `\jmp` — Link text
-   `\k` — Keyword/keyterm
-   `\nd` — Name of God
-   `\ord` — Ordinal ending
-   `\pn` — Proper name
-   `\png` — Geographic name
-   `\qt` — Quoted text
-   `\rb` — Ruby gloss
-   `\rq` — Inline quotation refs
-   `\ref` — Scripture reference
-   `\sig` — Author’s signature
-   `\sls` — Secondary source
-   `\tl` — Transliterated words
-   `\w` — Wordlist entry
-   `\wa` — Aramaic wordlist entry
-   `\wg` — Greek wordlist entry
-   `\wh` — Hebrew wordlist entry
-   `\wj` — Words of Jesus

**Deprecated:**

-   `\addpn` — Addition + name
-   `\pro` — Pronunciation annotation

### Text Formatting

-   `\bd` — Bold text
-   `\it` — Italic text
-   `\bdit` — Bold+italic text
-   `\no` — Normal text
-   `\sc` — Smallcap text
-   `\sup` — Superscript text

### Breaks

-   `\\` — Optional line break
-   `\pb` — Page break

### Introductions

-   `\ior` — Intro outline refs
-   `\iqt` — Intro quoted text

### Poetry

-   `\qac` — Acrostic character
-   `\qs` — Selah

### Lists

-   `\litl` — Entry total
-   `\lik` — Entry key
-   `\liv` — Entry value(s)

### Tables

-   `\th#` — Table column head
-   `\thr#` — Table column head (right aligned)
-   `\thc#` — Table column head (center aligned)
-   `\tc#` — Table cell
-   `\tcr#` — Table cell (right aligned)
-   `\tcc#` — Table cell (center aligned)

### Notes

#### Footnotes (character-level)

-   `\fr` — Origin reference
-   `\fq` — Translation quote
-   `\fqa` — Alternate translation
-   `\fk` — Keyword
-   `\ft` — Note text
-   `\fl` — Label text
-   `\fw` — Witness list
-   `\fp` — Additional paragraph
-   `\fv` — Verse number
-   `\fdc` — DC-only content
-   `\fm` — Reference mark

#### Cross References (character-level)

-   `\xo` — Origin reference
-   `\xop` — Published origin text
-   `\xk` — Keyword
-   `\xq` — Translation quote
-   `\xt` — Target references
-   `\xta` — Target added text
-   `\xot` — OT references
-   `\xnt` — NT references
-   `\xdc` — DC references

## Milestones

-   `\qt#` — Quotations
-   `\ts` — Translator’s section

## Notes (paragraph-level)

### Footnotes

-   `\f` — Footnote
-   `\fe` — Endnote
-   `\ef` — Extended Note

### Cross References

-   `\x` — Cross Reference
-   `\ex` — Extended CrossRef

## Plus notation inside notes and cross-references

USFM allows a subset of “+” prefixed markers within note bodies (footnotes `\f...\f*`, endnotes `\fe...\fe*`) and cross references (`\x...\x*`). These appear as markers starting with `\+` and are used to annotate structure within a note.

-   Common examples in cross-references:

    -   `\+xo` — Origin reference
    -   `\+xt` — Target references
    -   `\+xta` — Target added text
    -   `\+xk` — Keyword
    -   `\+xq` — Quotation

-   Examples in footnotes:
    -   `\+fr` — Origin reference
    -   `\+ft` — Note text

Behavior in Codex HTML intermediate:

-   We preserve “+” markers as inline spans with `data-tag` including the plus sign. Example: `\+xt Isaiah 29:14\+xt*` becomes `<span data-tag="+xt">Isaiah 29:14</span>`.
-   On export, if a `data-tag` begins with `+`, it is emitted back as a plus-prefixed USFM marker.

This ensures round-trip fidelity while allowing editing in HTML.

## Sidebars

-   `\esb` — Sidebar

## Content Category

-   `\cat` — Content Category

## Figures

-   `\fig` — Figure

## Peripherals

-   `\periph` — Peripheral division

### Books and Divisions

-   `\frt` — Front Matter
-   `\int` — Introductions
-   `\bak` — Back Matter

#### Back Matter (Standalone)

-   `\cnc` — Concordance
-   `\glo` — Glossary
-   `\tdx` — Topical Index
-   `\ndx` — Names Index

-   `\oth` — Other
