/**
 * TypeScript interfaces for DOCX (OOXML) file structure and round-trip export
 * Based on Office Open XML specification for loss-free round-trip editing
 * Similar to IDML types but adapted for DOCX structure
 */

// Core DOCX document structure
export interface DocxDocument {
    id: string;
    version: string;
    documentXml: string; // Original document.xml content
    paragraphs: DocxParagraph[];
    styles: DocxStyles;
    resources: DocxResources;
    metadata: DocxMetadata;
    originalHash: string; // SHA-256 hash of original file
    relationships: DocxRelationships;
    numbering?: DocxNumbering;
    settings?: DocxSettings;
}

// DOCX Paragraph
export interface DocxParagraph {
    id: string; // Unique identifier we assign
    paragraphIndex: number; // Position in document
    paragraphProperties: DocxParagraphProperties;
    runs: DocxRun[];
    beforeParagraphXml?: string; // XML before first run
    afterParagraphXml?: string; // XML after last run
    metadata?: Record<string, any>;
}

// DOCX Run (character-level content with formatting)
export interface DocxRun {
    id: string;
    runIndex: number; // Position within paragraph
    runProperties: DocxRunProperties;
    content: string; // The actual text content
    beforeRunXml?: string; // XML surrounding this run (for round-trip)
    afterRunXml?: string; // XML after this run
    metadata?: Record<string, any>;
}

// Paragraph properties (from w:pPr)
export interface DocxParagraphProperties {
    styleId?: string; // w:pStyle w:val
    alignment?: 'left' | 'center' | 'right' | 'justify' | 'both' | 'distribute'; // w:jc
    indentation?: {
        left?: number; // w:ind w:left
        right?: number; // w:ind w:right
        firstLine?: number; // w:ind w:firstLine
        hanging?: number; // w:ind w:hanging
    };
    spacing?: {
        before?: number; // w:spacing w:before
        after?: number; // w:spacing w:after
        line?: number; // w:spacing w:line
        lineRule?: string; // w:spacing w:lineRule
    };
    keepNext?: boolean; // w:keepNext
    keepLines?: boolean; // w:keepLines
    pageBreakBefore?: boolean; // w:pageBreakBefore
    widowControl?: boolean; // w:widowControl
    suppressLineNumbers?: boolean; // w:suppressLineNumbers
    outlineLevel?: number; // w:outlineLvl
    numberingProperties?: {
        numId?: number; // w:numPr w:numId
        ilvl?: number; // w:numPr w:ilvl
    };
    [key: string]: any; // Allow other properties
}

// Run properties (from w:rPr)
export interface DocxRunProperties {
    styleId?: string; // w:rStyle w:val
    bold?: boolean; // w:b
    italic?: boolean; // w:i
    underline?: string | boolean; // w:u w:val (single, double, etc.)
    strike?: boolean; // w:strike
    doubleStrike?: boolean; // w:dstrike
    smallCaps?: boolean; // w:smallCaps
    allCaps?: boolean; // w:caps
    color?: string; // w:color w:val
    highlight?: string; // w:highlight w:val
    fontSize?: number; // w:sz w:val (in half-points)
    fontFamily?: string; // w:rFonts w:ascii
    fontFamilyComplex?: string; // w:rFonts w:cs
    fontFamilyEastAsia?: string; // w:rFonts w:eastAsia
    superscript?: boolean; // w:vertAlign w:val="superscript"
    subscript?: boolean; // w:vertAlign w:val="subscript"
    spacing?: number; // w:spacing w:val (character spacing)
    position?: number; // w:position w:val (raised/lowered)
    kern?: number; // w:kern w:val
    lang?: string; // w:lang w:val
    [key: string]: any; // Allow other properties
}

// Style definitions (from styles.xml)
export interface DocxStyles {
    paragraphStyles: DocxParagraphStyle[];
    characterStyles: DocxCharacterStyle[];
    tableStyles: DocxTableStyle[];
    numberingStyles: DocxNumberingStyle[];
}

export interface DocxParagraphStyle {
    id: string;
    name: string;
    basedOn?: string;
    next?: string;
    paragraphProperties: DocxParagraphProperties;
    runProperties?: DocxRunProperties;
}

export interface DocxCharacterStyle {
    id: string;
    name: string;
    basedOn?: string;
    runProperties: DocxRunProperties;
}

export interface DocxTableStyle {
    id: string;
    name: string;
    basedOn?: string;
    [key: string]: any;
}

export interface DocxNumberingStyle {
    id: string;
    name: string;
    [key: string]: any;
}

// Resources (images, fonts, etc.)
export interface DocxResources {
    images: DocxImage[];
    fonts: DocxFont[];
    media: DocxMedia[];
}

export interface DocxImage {
    id: string;
    relationshipId: string;
    path: string; // Path in DOCX zip (e.g., word/media/image1.png)
    contentType: string;
    data?: ArrayBuffer; // Actual image data
    width?: number;
    height?: number;
}

export interface DocxFont {
    name: string;
    family?: string;
    charset?: string;
    embedded?: boolean;
}

export interface DocxMedia {
    id: string;
    path: string;
    contentType: string;
    data?: ArrayBuffer;
}

// Relationships (from document.xml.rels)
export interface DocxRelationships {
    relationships: DocxRelationship[];
}

export interface DocxRelationship {
    id: string;
    type: string;
    target: string;
    targetMode?: string;
}

// Numbering definitions (from numbering.xml)
export interface DocxNumbering {
    abstractNums: DocxAbstractNum[];
    nums: DocxNum[];
}

export interface DocxAbstractNum {
    id: string;
    levels: DocxNumberingLevel[];
}

export interface DocxNumberingLevel {
    ilvl: number;
    start?: number;
    numFmt: string;
    lvlText: string;
    paragraphProperties?: DocxParagraphProperties;
    runProperties?: DocxRunProperties;
}

export interface DocxNum {
    id: number;
    abstractNumId: string;
}

// Settings (from settings.xml)
export interface DocxSettings {
    [key: string]: any;
}

// Document metadata (from core.xml)
export interface DocxMetadata {
    title?: string;
    subject?: string;
    creator?: string;
    keywords?: string;
    description?: string;
    lastModifiedBy?: string;
    revision?: string;
    created?: string;
    modified?: string;
    category?: string;
    [key: string]: any;
}

// Cell metadata for Codex notebooks
export interface DocxCellMetadata {
    cellId: string;
    paragraphId: string;
    paragraphIndex: number;
    runIndex?: number;
    originalContent: string;

    // Structure preservation for round-trip
    docxStructure: {
        paragraphProperties: DocxParagraphProperties;
        runProperties?: DocxRunProperties;
        beforeParagraphXml?: string;
        afterParagraphXml?: string;
        beforeRunXml?: string;
        afterRunXml?: string;
    };

    // Optional cell label
    cellLabel?: string;
}

// Export configuration
export interface DocxExportConfig {
    preserveFormatting: boolean;
    preserveStyles: boolean;
    validateOutput: boolean;
    strictMode: boolean;
}

// Round-trip validation
export interface DocxRoundTripValidation {
    isValid: boolean;
    originalHash: string;
    reconstructedHash: string;
    differences: DocxDifference[];
    warnings: string[];
    errors: string[];
}

export interface DocxDifference {
    type: 'content' | 'formatting' | 'structure' | 'metadata';
    location: string;
    original: any;
    reconstructed: any;
    severity: 'low' | 'medium' | 'high' | 'critical';
}

// Parser configuration
export interface DocxParseConfig {
    preserveAllFormatting: boolean;
    extractImages: boolean;
    extractFootnotes: boolean;
    extractTables: boolean;
    segmentationStrategy: 'paragraph' | 'sentence' | 'run';
    validateStructure: boolean;
}

// Error types
export class DocxParseError extends Error {
    constructor(
        message: string,
        public location?: string,
        public xmlPath?: string
    ) {
        super(message);
        this.name = 'DocxParseError';
    }
}

export class DocxExportError extends Error {
    constructor(
        message: string,
        public config: DocxExportConfig,
        public originalDocument?: DocxDocument
    ) {
        super(message);
        this.name = 'DocxExportError';
    }
}

export class DocxValidationError extends Error {
    constructor(
        message: string,
        public validation: DocxRoundTripValidation
    ) {
        super(message);
        this.name = 'DocxValidationError';
    }
}

