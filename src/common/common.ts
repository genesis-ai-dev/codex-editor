export const DEBUG_MODE = false;

export const NAME = 'scripture-notebook';
export const MIME_TYPE = 'x-application/scripture-notebook';
export const LABEL = 'Scripture Notebook';
export const LANGUAGE = 'scripture-notebook';
export const DESCRIPTION = 'A notebook for editing Scripture translations.';

// export function formatURL(url: string): string {
//     if(!url.startsWith('http')) {
//         return `http://${url}`;
//     } 

//     return url;
// }


export function logDebug(item: string | any) {
    if (DEBUG_MODE) {
        console.log(item);
    }
}