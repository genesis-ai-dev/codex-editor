import archiver from "archiver";
import * as fs from "fs";
import { basename } from "path";

export const zipDirectory = (sourceDir: string, destZipPath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destZipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", resolve);
        archive.on("error", reject);

        archive.pipe(output);
        archive.directory(sourceDir, basename(sourceDir));
        archive.finalize();
    });
};
