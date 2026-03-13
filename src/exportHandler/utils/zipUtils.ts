import JSZip from "jszip";
import * as fs from "fs";
import * as path from "path";

function addDirToZip(zip: JSZip, dirPath: string, zipRoot: string): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const zipPath = path.join(zipRoot, entry.name).replace(/\\/g, "/");
        if (entry.isDirectory()) {
            addDirToZip(zip, fullPath, zipPath);
        } else {
            zip.file(zipPath, fs.readFileSync(fullPath));
        }
    }
}

export const zipDirectory = async (sourceDir: string, destZipPath: string): Promise<void> => {
    const zip = new JSZip();
    const rootName = path.basename(sourceDir);
    addDirToZip(zip, sourceDir, rootName);
    const buffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
    });
    await fs.promises.writeFile(destZipPath, buffer);
};
