declare module "archiver" {
    import { Readable, Transform } from "stream";

    interface ArchiverOptions {
        zlib?: {
            level?: number;
        };
    }

    interface EntryData {
        name: string;
        prefix?: string;
        stats?: any;
    }

    interface Archiver extends Transform {
        pointer(): number;
        pipe<T extends NodeJS.WritableStream>(destination: T): T;
        append(source: Buffer | Readable | string, data?: { name: string; }): this;
        directory(
            dirpath: string,
            destpath: string | false,
            data?: ((entry: EntryData) => EntryData | false) | EntryData
        ): this;
        file(filepath: string, data?: { name: string; }): this;
        finalize(): Promise<void>;
        abort(): void;
        on(event: "entry", listener: (entry: { name: string; }) => void): this;
        on(event: "error", listener: (err: Error) => void): this;
        on(event: "warning", listener: (err: Error) => void): this;
        on(event: "close" | "end" | "drain", listener: () => void): this;
    }

    function archiver(format: "zip" | "tar", options?: ArchiverOptions): Archiver;
    export = archiver;
}
