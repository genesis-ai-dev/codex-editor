declare module '@fetsorn/isogit-lfs' {
    export function pointsToLFS(blob: Uint8Array): boolean;
    export function readPointer(options: { gitdir: string; content: Uint8Array; }): any;
    export function downloadBlobFromPointer(options: any, pointer: any): Promise<Uint8Array>;
    export function uploadBlob(options: any, blob: Uint8Array): Promise<any>;
    export function formatPointerInfo(pointerInfo: any): Uint8Array;
}