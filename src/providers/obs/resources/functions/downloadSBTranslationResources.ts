import { Uri, workspace } from "vscode";
import * as path from "path";
import JSZip from "jszip";
import moment from "moment";

interface Params {
    projectResource: any; // Replace 'any' with the actual type
    resourcesFolder: Uri;
}

export const downloadSBTranslationResources = async ({
    projectResource,
    resourcesFolder,
}: Params) => {
    try {
        // FIXME: Check for duplicate resources
        const downloadProjectName = `${projectResource?.name}`;
        // const downloadProjectName = `${projectResource?.name}_${projectResource?.owner}_${projectResource?.release?.tag_name}`;

        const downloadResourceFolder = Uri.joinPath(
            resourcesFolder,
            downloadProjectName,
        );

        await workspace.fs.createDirectory(downloadResourceFolder);

        const res = await fetch(projectResource?.zipball_url);
        const blob = await res.arrayBuffer();

        const zipUri = Uri.joinPath(
            resourcesFolder,
            `${projectResource?.name}.zip`,
        );

        await workspace.fs.writeFile(zipUri, Buffer.from(blob));

        const fileContents = blob;
        const result = await JSZip.loadAsync(fileContents);
        const keys = Object.keys(result.files);

        for (const key of keys) {
            const item = result.files[key];
            if (item.dir) {
                await workspace.fs.createDirectory(
                    Uri.joinPath(downloadResourceFolder, item.name),
                );
            } else {
                const bufferContent = Buffer.from(
                    await item.async("arraybuffer"),
                );
                const path = [...item?.name?.split("/")];
                path.shift();
                const fileUri = Uri.joinPath(
                    downloadResourceFolder,
                    path.join("/"),
                );
                await workspace.fs.writeFile(fileUri, bufferContent);
            }
        }

        const metadataRes = await fetch(projectResource.metadata_json_url);
        const data = (await metadataRes.json()) as Record<string, any>;
        data.agOffline = true;
        data.meta = projectResource;
        data.lastUpdatedAg = moment().format();
        await workspace.fs.writeFile(
            Uri.joinPath(downloadResourceFolder, "metadata.json"),
            Buffer.from(JSON.stringify(data)),
        );
        await workspace.fs.delete(zipUri);
        return {
            folder: downloadResourceFolder,
        };
    } catch (err) {
        console.error(err);
        throw err;
    }
};
