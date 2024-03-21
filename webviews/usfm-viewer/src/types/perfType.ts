export interface Perf {
  schema: Schema;
  metadata: Metadata;
  sequences: Sequences;
  mainSequenceId: string;
}
export interface Schema {
  structure: string;
  structure_version: string;
  constraints?: ConstraintsEntity[] | null;
}
export interface ConstraintsEntity {
  name: string;
  version: string;
}
export interface Metadata {
  translation: Translation;
  document: Document;
}
export interface Translation {
  id: string;
  selectors: Selectors;
  properties: Properties;
  tags?: null[] | null;
}
export interface Selectors {
  lang: string;
  abbr: string;
}
export interface Properties {}
export interface Document {
  id: string;
  bookCode: string;
  h: string;
  properties: Properties;
  tags?: null[] | null;
}
export interface Sequences {
  [sequenceId: string]: SequenceBlock;
}
export interface SequenceBlock {
  type: string;
  blocks?: BlocksEntity[] | null;
}
export interface BlocksEntity {
  type: string;
  subtype: string;
  target?: string | null;
  content?: ContentBlock | string | null;
}
export interface ContentBlock {
  type: string;
  subtype: string;
  atts: Atts;
}
export interface Atts {
  number: string;
}

