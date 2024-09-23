export interface Item {
    ref: string;
    text: string;
    uri: string;
    codexText?: string;
    codexUri?: string;
}

export interface OpenFileMessage {
    command: "openFileAtLocation";
    uri: string;
    word: string;
}

export interface SearchCommand {
    command: string;
    query: string;
    database: string;
}

export interface SearchResults {
    bibleResults: Item[];
    codexResults: Item[];
}
