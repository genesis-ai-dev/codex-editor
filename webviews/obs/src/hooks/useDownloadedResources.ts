import { useEffect, useState } from "react";
import { vscode } from "@/utilities/vscode";
import { DownloadedResource, MessageType } from "../types";

export const useDownloadedResource = () => {
    const [downloadedResources, setDownloadedResources] = useState<
        DownloadedResource[]
    >([]);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case MessageType.SYNC_DOWNLOADED_RESOURCES:
                    setDownloadedResources(
                        event.data.payload.downloadedResources,
                    );
                    break;
            }
        });

        vscode.postMessage({
            type: MessageType.SYNC_DOWNLOADED_RESOURCES,
            payload: {},
        });
    }, []);

    return { downloadedResources };
};
