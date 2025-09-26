// Declaration file to define module types for TypeScript

declare module '@/extension' {
    export function getAddWordToSpellcheckApi(): any;
    export function getSpellCheckResponseForText(): any;
    // In runtime, getAuthApi() returns a FrontierAPI | undefined synchronously.
    // Keep it as `any` here to avoid circular type deps.
    export function getAuthApi(): any;
}

declare module '@/utils/semanticSearch' {
    export function getSimilarCellIds(): any;
}

declare module './chapterGenerationManager' {
    export class ChapterGenerationManager {
        // Add any methods or properties used in the code
    }
}

declare module '../../backtranslation' {
    export function generateBackTranslation(): any;
    export function editBacktranslation(): any;
    export function getBacktranslation(): any;
    export function setBacktranslation(): any;
}

declare module '../../actions/suggestions/rejectEditSuggestion' {
    export function rejectEditSuggestion(): any;
} 
