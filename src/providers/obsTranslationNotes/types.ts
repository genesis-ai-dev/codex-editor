export type ObsTsv = {
    Reference: string;
    ID: string;
    Tags: string;
    SupportReference: string;
    Quote: string;
    Occurrence: string;
    Note: string;
    [key: string]: string;
};

export type storyParagraphRef<T extends { Reference: string }> = {
    [story: string]: {
        [paragraph: string]: T[];
    };
};
