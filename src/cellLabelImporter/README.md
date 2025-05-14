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

- Parses different timestamp formats (HH:MM:SS,mmm, MM:SS.mmm, or raw seconds)
- Matches cells using exact or nearest-match timestamp matching
- Updates both source and target (.source and .codex) files when labels are applied
- Preserves all other metadata and content during updates

## Example Use Case

This feature is particularly useful for adding speaker labels to transcribed dialogue files, where you want to identify which character is speaking in each cell.
