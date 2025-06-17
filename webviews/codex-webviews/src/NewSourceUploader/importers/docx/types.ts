export interface DocxMammothOptions {
    arrayBuffer: ArrayBuffer;
    styleMap?: string[];
    transformDocument?: (element: MammothElement) => MammothElement;
}

export interface MammothElement {
    type: string;
    styleId?: string;
    styleProperties?: MammothStyleProperties;
    style?: string;
}

export interface MammothStyleProperties {
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    backgroundColor?: string;
    textAlign?: string;
    lineHeight?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    borderTop?: string;
    borderBottom?: string;
    borderLeft?: string;
    borderRight?: string;
}

export interface DocxParsingOptions {
    preserveStyles?: boolean;
    extractImages?: boolean;
    splitStrategy?: 'paragraphs' | 'sections' | 'pages';
    imageProcessing?: {
        convertToBase64?: boolean;
        maxImageSize?: number;
    };
} 