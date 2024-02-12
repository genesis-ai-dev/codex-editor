import { useEffect, useState } from "react";
import { vscode } from "@/utilities/vscode";
import { MessageType } from "@/types";
import { DownloadedResource } from "@/types";

export const useDownloadedResource = () => {
    const [downloadedResources, setDownloadedResources] = useState<
        DownloadedResource[]
    >([]);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            console.log("event.data.type -> ", event.data.type);
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
        console.log("useDownloadedResource -> useEffect -> postMessage");
    }, []);

    return { downloadedResources };
};
