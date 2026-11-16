import { mergePinDecisions, timestampPinDecisions } from "./pinDecisions";
import { replaceMetadataPinsInText } from "./metadataPinTextEdit";

/** Called only with the successfully cloned revision, never a failed/absent fetch. */
export function applyRemoteUpdatePins(mergedText: string, remoteText: string, ignorePins: boolean): string {
    const remote = JSON.parse(remoteText.replace(/^\uFEFF/, ""));
    if (!remote || typeof remote !== "object" || Array.isArray(remote) || (remote.meta !== undefined && (!remote.meta || typeof remote.meta !== "object" || Array.isArray(remote.meta)))) {
        throw new Error("Invalid cloned project metadata");
    }
    if (ignorePins) { return replaceMetadataPinsInText(mergedText, {}); }
    const remotePins = remote.meta?.pinnedExtensions === undefined ? {} : remote.meta.pinnedExtensions;
    const local = JSON.parse(mergedText.replace(/^\uFEFF/, ""));
    return replaceMetadataPinsInText(mergedText, timestampPinDecisions(mergePinDecisions(local.meta?.pinnedExtensions ?? {}, remotePins)));
}
