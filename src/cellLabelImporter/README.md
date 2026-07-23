# Cell Label Importer

The Cell Label Importer is a tool for importing and managing cell labels from external sources like subtitle or transcript files. It allows users to:

1. Import cell labels from Excel or CSV files
2. Match imported labels with existing cells in .source and .codex files
3. View and edit the matches
4. Apply selected labels to update both source and target files

## Features

- **Import from Excel/CSV**: Support for importing character and dialogue data from spreadsheet files
- **Intelligent Matching**: Uses timestamp information to match imported data with existing cells
- **Bulk Actions**: Select/deselect all matched cells at once
- **Pagination**: Handle large datasets with efficient pagination
- **Preview**: Show both current and new labels before applying changes

## Usage

1. Open the Cell Label Importer from the command palette with "Codex: Import Cell Labels"
2. Click "Import From File" and select your Excel or CSV file
3. Review the matched labels (green rows) and unmatched items (red rows)
4. Select which labels to apply using the checkboxes
5. Click "Save Selected" to apply the changes or "Cancel" to discard

## Supported Import Format

The importer expects spreadsheet files with columns containing:

- A type column ("cue" is recognized as a valid caption/subtitle entry)
- Start and end timestamps (in various formats)
- Optional "character" column for speaker names
- Optional "dialogue" column for the actual text

### Recognized timestamp columns

A row is only processed if the importer can find a start time for it. Headers recognized as
carrying a start time include `START`, `STARTTIME`, `Start Time`, `Time In`, and `TC In`, plus a
`TIMESTAMP` column holding a full range (`00:00:41.792 --> 00:00:43.043`).

Where more than one column claims to be the start, one whose values are actually shaped like
timecode wins — dialogue lists in the wild carry duplicated or copy-pasted headers, and a column
headed `TC In` that really holds line numbers must not be read as seconds.

### Recognized timestamp formats

| Format | Example |
|--------|---------|
| `HH:MM:SS,mmm` / `HH:MM:SS.mmm` | `00:01:03.209` |
| `HH:MM:SS` | `00:01:03` |
| `MM:SS.mmm` / `MM:SS` | `01:03.209` |
| Raw seconds | `63.209` |
| SMPTE timecode `HH:MM:SS:FF` | `00:01:03:05` |

For SMPTE timecode the frame rate is inferred from the largest frame value in the file, since
frames run `0..fps-1`. This resolves to the nominal rate (24/25/30/50/60) rather than a
pulled-down variant such as 23.976 — the two cannot be told apart from frame values alone, and
they differ by far less than the matcher's tolerance. `HH:MM:SS` is read as clock time and the
frame field as the sub-second remainder.

Prefer keeping sub-second precision. Timestamps rounded to whole seconds still match, but
neighbouring cues can collapse onto the same cell.

Example TSV:

```tsv
index	type	start		end	CHARACTER	DIALOGUE
0	cue	00:00:50,634	00:00:50,63	00:00:51,468	LITTLE MARY MAGDALENE	Abba?
1	cue	00:00:54,012	00:00:54,01	00:00:56,348	 MARY MAGDALENE'S FATHER	You should be sleeping, little one.
1	cue	00:00:54,012	00:00:54,01	00:00:56,348	LITTLE MARY MAGDALENE	I can't sleep.
2	cue	00:00:56,431	00:00:56,43	00:00:58,308	 MARY MAGDALENE'S FATHER	Sit down, sit down.
3	cue	00:00:59,601	00:00:59,60	00:01:02,437	 MARY MAGDALENE'S FATHER	Is your head hurting you again?
3	cue	00:00:59,601	00:00:59,60	00:01:02,437	LITTLE MARY MAGDALENE	No.
4	cue	00:01:02,521	00:01:02,52	00:01:06,233	 MARY MAGDALENE'S FATHER	I know. You were thinking of the big new star.
```

## Technical Implementation

The Cell Label Importer:

- Parses different timestamp formats (HH:MM:SS,mmm, MM:SS.mmm, SMPTE HH:MM:SS:FF, or raw seconds)
- Matches cells using exact or nearest-match timestamp matching
- Assigns one cell per row when several cells share a start time (see below)
- Updates both source and target (.source and .codex) files when labels are applied
- Preserves all other metadata and content during updates

### Simultaneous speakers

Several cells legitimately share one start time when characters speak at once — a group greeting,
a crowd reciting together. The importer indexes *every* cell at a given start time and hands them
out in file order, so N rows at the same timestamp fill N distinct cells.

This assumes the rows and the cells are in the same order, which is the only signal available:
such cells typically carry identical text and identical times, so nothing else distinguishes them.
Rows beyond the number of cells at that timestamp are left unmatched rather than overwriting a
label an earlier row set.

## Example Use Case

This feature is particularly useful for adding speaker labels to transcribed dialogue files, where you want to identify which character is speaking in each cell.
