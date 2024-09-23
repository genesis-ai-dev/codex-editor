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
    text: string;
    replacements?: ReplacementsEntity[] | null;
    offset: number;
    length: number;
}
export interface ReplacementsEntity {
    value: string;
}
