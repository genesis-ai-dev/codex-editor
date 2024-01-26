/**********************
 * Conversation Types *
 **********************/

/* Message is a single content string with metadata about the sender and identifiable anchors for the message (i.e., places where the message is relevant as linked by the sender). */
export type Message = {
    id: string;
    role: SenderRole;
    sender: Sender;
    content: string;
    links: Link[];
};

/* SenderRole is the role of the sender of a message. */
export enum SenderRole {
    USER,
    AI,
}

/* Sender is the sender of a message. */
export type Sender = {
    name: string;
    id: string;
};

/* Conversation is a list of messages and links to identifiable anchors for the conversation. */
export type Conversation = {
    id: string;
    messages: Message[];
    links: Link[];
};

/* Links connect a message of conversation to an identifier where a message is relevant. */
export type Link = {
    id: string;
    targetId?: string;
    // Theoretically, we could include commit hashes and uris/document positions here.
};

/***************
 * Codex Types *
 ***************/

/* Codex is a Jupyter-like notebook with a list of "code" cells (i.e., kind=2) and a list of "markdown" cells (i.e., kind=1). */

export type Codex = {
    id: string;
    cells: Cell[];
};

/* Cell is a single cell in a Codex. */
export type Cell = {
    id: string;
    kind: CellKind;
    content: string;
    links: Link[];
    metadata: CellMetadata;
};

/* CellKind is the export type of cell. */
export enum CellKind {
    MARKDOWN,
    CODE,
}

/* CellMetadata is the metadata for a cell. */
export type CellMetadata = {
    vrefs: VRef[];
    notes: Note[];
    [key: string]: any;
};

/* Note is a single note. */
export type Note = {
    id: string;
    content: string;
    links: Link[];
    createdAt: Date;
    updatedAt: Date;
};

/* VRef is a reference to an ORG Bible verse. */
export type VRef = {
    book: string;
    chapter: number;
    verse: number;
};

/* Dictionary is an extensible JSON dictionary of words and their definitions, plus additional metadata. */
export type Dictionary = {
    id: string;
    label: string;
    entries: DictionaryEntry[];
    metadata: DictionaryMetadata;
};

/* DictionaryMetadata is the metadata for a dictionary. */
export type DictionaryMetadata = {
    [key: string]: any;
};

/* DictionaryEntry is a single entry in a dictionary. */
export type DictionaryEntry = {
    id: string;
    headForm: string; // This can be auto-populated as a quick action in the editor
    /* 
    Users can merge entries with the same or similar head forms
    by adding the entry ids to the linkedEntries array.

    This array of variants functions like a list of linked entries, but all the variants have their own entries.
    */
    variantForms: string[] | DictionaryEntry[]; // FIXME: we could use the headword string... or we could use the entry id... or we could use the entry itself...
    definition: string;
    translationEquivalents: LanguageTaggedString[];
    links: Link[];
    linkedEntries: string[];
    metadata: DictionaryEntryMetadata;
    notes: Note[];
    [key: string]: any;
};

export type LanguageTaggedString = {
    languageCode?: string;
    languageName?: string;
    content: string;
}

/* DictionaryEntryMetadata is the metadata for a dictionary entry. */
export type DictionaryEntryMetadata = {
    [key: string]: any;
};

/***************
 * Project Types *
 ***************/

/* 
Project is a collection of Codex notebooks, Conversations, Dictionaries, and other project files. 
Projects follow the Scripture Burrito metadata spec: https://docs.burrito.bible/en/latest/?badge=latest
*/

export type RelativePath = string; /** This is going to be a URI relative to the project root */
export type HTMLString = string; /** This is going to be stringified of HTML */

/* TODO: evaluate this type definition with Joel and Ben */
export type Project = {
    format: string
    meta: {
      version: string
      category: string
      generator: {
        softwareName: string
        softwareVersion: string
        userName: string
      }
      defaultLocale: string
      dateCreated: string
      normalization: string
      comments: Array<string>
    }
    idAuthorities: any
    identification: any
    languages: Array<{
      tag: string
      name: {
        [key: string]: string
      }
    }>
    type: {
      flavorType: {
        name: string
        flavor: {
          name: string
          usfmVersion: string
          translationType: string
          audience: string
          projectType: string
        }
        currentScope: {
          GEN: Array<string>
          EXO: Array<string>
          LEV: Array<string>
          NUM: Array<string>
          DEU: Array<string>
          JOS: Array<string>
          JDG: Array<string>
          RUT: Array<string>
          "1SA": Array<string>
          "2SA": Array<string>
          "1KI": Array<string>
          "2KI": Array<string>
          "1CH": Array<string>
          "2CH": Array<string>
          EZR: Array<string>
          NEH: Array<string>
          EST: Array<string>
          JOB: Array<string>
          PSA: Array<string>
          PRO: Array<string>
          ECC: Array<string>
          SNG: Array<string>
          ISA: Array<string>
          JER: Array<string>
          LAM: Array<string>
          EZK: Array<string>
          DAN: Array<string>
          HOS: Array<string>
          JOL: Array<string>
          AMO: Array<string>
          OBA: Array<string>
          JON: Array<string>
          MIC: Array<string>
          NAM: Array<string>
          HAB: Array<string>
          ZEP: Array<string>
          HAG: Array<string>
          ZEC: Array<string>
          MAL: Array<string>
          "1ES": Array<string>
          "2ES": Array<string>
          TOB: Array<string>
          JDT: Array<string>
          ESG: Array<string>
          WIS: Array<string>
          SIR: Array<string>
          BAR: Array<string>
          LJE: Array<string>
          S3Y: Array<string>
          SUS: Array<string>
          BEL: Array<string>
          MAN: Array<string>
          "1MA": Array<string>
          "2MA": Array<string>
          MAT: Array<string>
          MRK: Array<string>
          LUK: Array<string>
          JHN: Array<string>
          ACT: Array<string>
          ROM: Array<string>
          "1CO": Array<string>
          "2CO": Array<string>
          GAL: Array<string>
          EPH: Array<string>
          PHP: Array<string>
          COL: Array<string>
          "1TH": Array<string>
          "2TH": Array<string>
          "1TI": Array<string>
          "2TI": Array<string>
          TIT: Array<string>
          PHM: Array<string>
          HEB: Array<string>
          JAS: Array<string>
          "1PE": Array<string>
          "2PE": Array<string>
          "1JN": Array<string>
          "2JN": Array<string>
          "3JN": Array<string>
          JUD: Array<string>
          REV: Array<string>
        }
      }
    }
    confidential: boolean
    agencies: Array<any>
    targetAreas: Array<any>
    localizedNames: {
      [key: string]: {
        abbr: {
          [key: string]: string
        }
        short: {
          [key: string]: string
        }
        long: {
          [key: string]: string
        }
      }
    }
    ingredients?: {
      [key: RelativePath]: {
        checksum?: {
          [key: string]: string
        }
        mimeType?: string
        size?: number
        scope?: {
            [key: string]: Array<any>
          }
      }
    }
    copyright: {
      shortStatements: Array<{
        statement: string | HTMLString
        mimetype: string
        lang: string
      }>
    }
  }
  