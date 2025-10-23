/**
 * TypeScript interfaces for InDesign IDML file structure and round-trip testing
 * Based on Adobe IDML specification for loss-free round-trip editing
 */

// Core IDML document structure
export interface IDMLDocument {
    id: string;
    version: string;
    stories: IDMLStory[];
    styles: IDMLStyles;
    resources: IDMLResources;
    metadata: IDMLMetadata;
    originalHash: string; // SHA-256 hash of original file
}

// IDML Story (text container)
export interface IDMLStory {
    id?: string;
    name?: string;
    paragraphs: IDMLParagraph[];
    metadata?: Record<string, any>;
}

// IDML Paragraph with style ranges
export interface IDMLParagraph {
    id?: string;
    paragraphStyleRange: IDMLParagraphStyleRange;
    characterStyleRanges: IDMLCharacterStyleRange[];
    metadata?: Record<string, any>;
}

// Paragraph style range
export interface IDMLParagraphStyleRange {
    id?: string;
    appliedParagraphStyle: string;
    properties: IDMLParagraphProperties;
    content: string;
}

// Character style range
export interface IDMLCharacterStyleRange {
    id?: string;
    appliedCharacterStyle: string;
    properties: IDMLCharacterProperties;
    content: string;
    startIndex: number;
    endIndex: number;
}

// Paragraph properties
export interface IDMLParagraphProperties {
    justification?: 'left' | 'center' | 'right' | 'justify';
    spaceBefore?: number;
    spaceAfter?: number;
    firstLineIndent?: number;
    leftIndent?: number;
    rightIndent?: number;
    tabStops?: IDMLTabStop[];
    [key: string]: any;
}

// Character properties
export interface IDMLCharacterProperties {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: string;
    fontStyle?: 'normal' | 'italic';
    color?: string;
    backgroundColor?: string;
    underline?: boolean;
    strikethrough?: boolean;
    superscript?: boolean;
    subscript?: boolean;
    [key: string]: any;
}

// Tab stop definition
export interface IDMLTabStop {
    position: number;
    alignment: 'left' | 'center' | 'right' | 'decimal';
    leader?: string;
}

// Style definitions
export interface IDMLStyles {
    paragraphStyles: IDMLParagraphStyle[];
    characterStyles: IDMLCharacterStyle[];
}

export interface IDMLParagraphStyle {
    id: string;
    name: string;
    properties: IDMLParagraphProperties;
    basedOn?: string;
    nextStyle?: string;
}

export interface IDMLCharacterStyle {
    id: string;
    name: string;
    properties: IDMLCharacterProperties;
    basedOn?: string;
}

// Resources (fonts, colors, etc.)
export interface IDMLResources {
    fonts: IDMLFont[];
    colors: IDMLColor[];
    images: IDMLImage[];
}

export interface IDMLFont {
    id: string;
    name: string;
    family: string;
    style: string;
    embedded?: boolean;
}

export interface IDMLColor {
    id: string;
    name: string;
    type: 'CMYK' | 'RGB' | 'Spot' | 'MixedInk';
    values: number[];
}

export interface IDMLImage {
    id: string;
    href: string;
    width: number;
    height: number;
    resolution: number;
}

// Document metadata
export interface IDMLMetadata {
    title?: string;
    author?: string;
    createdDate?: string;
    modifiedDate?: string;
    documentId?: string;
    [key: string]: any;
}

// HTML representation for editing
export interface IDMLHTMLRepresentation {
    documentId: string;
    stories: IDMLHTMLStory[];
    styles: IDMLStyles;
    resources: IDMLResources;
    metadata: IDMLMetadata;
    originalHash: string;
}

export interface IDMLHTMLStory {
    id: string;
    name?: string;
    html: string;
    metadata?: Record<string, any>;
}

// Round-trip validation results
export interface RoundTripValidationResult {
    isLossFree: boolean;
    originalHash: string;
    reconstructedHash: string;
    differences: RoundTripDifference[];
    warnings: string[];
    errors: string[];
    validationTimestamp: string;
}

export interface RoundTripDifference {
    type: 'content' | 'formatting' | 'structure' | 'metadata';
    location: string; // XPath or description
    original: any;
    reconstructed: any;
    severity: 'low' | 'medium' | 'high' | 'critical';
}

// Import/Export configuration
export interface IDMLImportConfig {
    preserveAllFormatting: boolean;
    preserveObjectIds: boolean;
    validateRoundTrip: boolean;
    strictMode: boolean;
    customStyleMapping?: Record<string, string>;
}

export interface IDMLExportConfig {
    preserveAllFormatting: boolean;
    preserveObjectIds: boolean;
    validateOutput: boolean;
    strictMode: boolean;
    customStyleMapping?: Record<string, string>;
}

// Test data for TDD
export interface IDMLTestData {
    name: string;
    description: string;
    originalFile: string; // Base64 encoded IDML
    expectedStructure: Partial<IDMLDocument>;
    testCases: IDMLTestCase[];
}

export interface IDMLTestCase {
    name: string;
    description: string;
    input: any;
    expectedOutput: any;
    shouldFail?: boolean;
    errorMessage?: string;
}

// Hash utilities for validation
export interface HashValidation {
    algorithm: 'sha256' | 'sha512' | 'md5';
    originalHash: string;
    computedHash: string;
    match: boolean;
    timestamp: string;
}

// Error types for better error handling
export class IDMLParseError extends Error {
    constructor(
        message: string,
        public location?: string,
        public line?: number,
        public column?: number
    ) {
        super(message);
        this.name = 'IDMLParseError';
    }
}

export class IDMLValidationError extends Error {
    constructor(
        message: string,
        public validationResult: RoundTripValidationResult
    ) {
        super(message);
        this.name = 'IDMLValidationError';
    }
}

export class IDMLExportError extends Error {
    constructor(
        message: string,
        public exportConfig: IDMLExportConfig,
        public originalDocument?: IDMLDocument
    ) {
        super(message);
        this.name = 'IDMLExportError';
    }
}
