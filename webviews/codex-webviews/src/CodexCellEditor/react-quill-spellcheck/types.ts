export interface SpellCheckerApi {
    url: string;
    body: SpellCheckerApiBody;
    headers: HeadersInit;
    method: string;
    mode: RequestMode;
    mapResponse: SpellCheckerResponseApi;
    matches?: MatchesEntity[];
}
export type SpellCheckerApiBody = (text: string) => BodyInit;
export type SpellCheckerResponseApi = (response: Response) => Promise<{
    language: Language;
    matches?: MatchesEntity[] | null;
}>;
export interface Language {
    name: string;
    code: string;
}
export interface DetectedLanguage {
    name: string;
    code: string;
    confidence: number;
}
export interface MatchesEntity {
    id: string;
    offset: number;
    length: number;
    text: string;
    replacements?: ReplacementsEntity[] | null;
    color?: "purple" | "blue" | "red"; // purple for LLM suggestions, blue for ICE suggestions, red for spelling
}
export interface ReplacementsEntity {
    value: string;
    confidence?: "high" | "low";
    source?: "llm" | "ice" | "spellcheck";
    frequency?: number;
}

export interface SpellCheckerApi {
    check: (text: string) => Promise<MatchesEntity[]>;
}
