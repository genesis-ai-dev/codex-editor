# In-Memory Indexes

## Source Bible Index

This index is used to store the source Bible verses with some metadata.

## Translation Pairs Index

This index is used to store the translation pairs with some metadata. Note, this index does not store ALL the source Bible verses, but only those with a translation pair in the target language.

## Zero Draft Index

This index is used to store the zero draft data with some metadata, and these can be either imported in bulk and inserted into the Codex notebook files, or inserted one by one as inline completion options.

Zero draft files need to be placed in the `files/zero_drafts` folder in the workspace.

Here are example files for each of the supported formats for importing zero draft data (txt, jsonl, json, and tsv) into Codex.

1. TXT Example (zero_draft_example.txt):
```txt
GEN 1:1	Au tout début, Dieu créa le ciel et la terre.
GEN 1:2	La terre n'avait pas de forme et était vide. Il y avait de l'obscurité sur l'abîme, et l'Esprit de Dieu flottait au-dessus des eaux.
MRK 1:6	Jean portait un vêtement en poils de chameau et une ceinture en cuir autour de la taille. Il mangeait des sauterelles et du miel sauvage.
MRK 1:1	Le commencement de la Bonne Nouvelle de Jésus-Christ, le Fils de Dieu.
TIT 1:1	Paul, serviteur de Dieu et apôtre de Jésus-Christ, pour la foi des élus de Dieu et la connaissance de la vérité dans la piété.
```

1. JSONL Example (zero_draft_example.jsonl):
```jsonl
{"vref": "GEN 1:1", "content": "Au tout début, Dieu créa le ciel et la terre.", "metadata": {"language": "French"}}
{"vref": "GEN 1:2", "content": "La terre n'avait pas de forme et était vide. Il y avait de l'obscurité sur l'abîme, et l'Esprit de Dieu flottait au-dessus des eaux.", "metadata": {"language": "French"}}
{"vref": "MRK 1:6", "content": "Jean portait un vêtement en poils de chameau et une ceinture en cuir autour de la taille. Il mangeait des sauterelles et du miel sauvage.", "metadata": {"language": "French"}}
{"vref": "MRK 1:1", "content": "Le commencement de la Bonne Nouvelle de Jésus-Christ, le Fils de Dieu.", "metadata": {"language": "French"}}
{"vref": "TIT 1:1", "content": "Paul, serviteur de Dieu et apôtre de Jésus-Christ, pour la foi des élus de Dieu et la connaissance de la vérité dans la piété.", "metadata": {"language": "French"}}
```

1. JSON Example (zero_draft_example.json):
```json
[
  {
    "vref": "GEN 1:1",
    "content": "Au tout début, Dieu créa le ciel et la terre.",
    "metadata": {
      "language": "French",
      "testament": "Old"
    }
  },
  {
    "vref": "GEN 1:2",
    "content": "La terre n'avait pas de forme et était vide. Il y avait de l'obscurité sur l'abîme, et l'Esprit de Dieu flottait au-dessus des eaux.",
    "metadata": {
      "language": "French",
      "testament": "Old"
    }
  },
  {
    "vref": "MRK 1:6",
    "content": "Jean portait un vêtement en poils de chameau et une ceinture en cuir autour de la taille. Il mangeait des sauterelles et du miel sauvage.",
    "metadata": {
      "language": "French",
      "testament": "New"
    }
  },
  {
    "vref": "MRK 1:1",
    "content": "Le commencement de la Bonne Nouvelle de Jésus-Christ, le Fils de Dieu.",
    "metadata": {
      "language": "French",
      "testament": "New"
    }
  },
  {
    "vref": "TIT 1:1",
    "content": "Paul, serviteur de Dieu et apôtre de Jésus-Christ, pour la foi des élus de Dieu et la connaissance de la vérité dans la piété.",
    "metadata": {
      "language": "French",
      "testament": "New"
    }
  }
]
```

1. TSV Example (zero_draft_example.tsv):
```tsv
GEN 1:1	Au tout début, Dieu créa le ciel et la terre.	French	Old Testament
GEN 1:2	La terre n'avait pas de forme et était vide. Il y avait de l'obscurité sur l'abîme, et l'Esprit de Dieu flottait au-dessus des eaux.	French	Old Testament
MRK 1:6	Jean portait un vêtement en poils de chameau et une ceinture en cuir autour de la taille. Il mangeait des sauterelles et du miel sauvage.	French	New Testament
MRK 1:1	Le commencement de la Bonne Nouvelle de Jésus-Christ, le Fils de Dieu.	French	New Testament
TIT 1:1	Paul, serviteur de Dieu et apôtre de Jésus-Christ, pour la foi des élus de Dieu et la connaissance de la vérité dans la piété.	French	New Testament
```

These examples demonstrate how the data can be structured in each of the supported file formats. You can use these as templates for creating test files or for documentation purposes. Each format has its own advantages:

- TXT: Simple and easy to read, but limited metadata support.
- JSONL: Good for large datasets, easy to append, and supports rich metadata.
- JSON: Supports rich metadata and is easy to read, but may be less efficient for very large datasets.
- TSV: Tabular format, easy to read and edit in spreadsheet applications, supports basic metadata.

The current implementation in `zeroDraftIndex.ts` can handle all of these formats, parsing them into the `ZeroDraftIndexRecord` structure for indexing and searching.

> Note: If there are duplicate verses in the zero draft file, the last occurrence of the verse will be used. E.g.,
> MRK 1:1 Début de la Bonne Nouvelle de Jésus-Christ, le Fils de Dieu.
> MRK 1:1 RYDER IS FORCE OVERWRITING THIS ONE <--- This one will be used
