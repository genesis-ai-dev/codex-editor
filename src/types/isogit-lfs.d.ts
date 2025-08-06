declare module '@fetsorn/isogit-lfs' {
    interface LFSModule {
        pointsToLFS(blob: Uint8Array): boolean;
        readPointer(options: { gitdir: string; content: Uint8Array; }): any;
        downloadBlobFromPointer(options: any, pointer: any): Promise<Uint8Array>;
        uploadBlobs(options: any, blobs: Uint8Array[]): Promise<any[]>;
        formatPointerInfo(pointerInfo: any): Uint8Array;
        readPointerInfo(blob: Uint8Array): any;
        buildPointerInfo(info: any): any;
        downloadUrlFromPointer(options: any, pointer: any): Promise<string>;
        populateCache(gitdir: string, ref?: string): Promise<void>;
        addLFS(options: any): any;
    }

    const lfs: LFSModule;
    export default lfs;
}