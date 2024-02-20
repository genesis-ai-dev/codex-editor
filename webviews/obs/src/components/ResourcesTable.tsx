/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import fetchResource from "../utilities/fetchResources";
import { vscode } from "../utilities/vscode";
import { useDownloadedResource } from "../hooks/useDownloadedResources";
import { useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { TRANSLATION_RESOURCE_TYPES } from "../utilities/fetchTranslationResource";
import { MessageType } from "../types";

const RESOURCE_TYPES = [
    {
        label: "OBS",
        key: "obs",
    },
    {
        label: "Bible",
        key: "bible",
    },
    ...TRANSLATION_RESOURCE_TYPES,
] as const;
const ResourcesTable = () => {
    const [resourceType, setResourceType] =
        useState<(typeof RESOURCE_TYPES)[number]["key"]>("obs");
    const { data: resources } = useQuery({
        queryKey: ["resources", resourceType],
        queryFn: () => {
            return fetchResource(false, [], [], resourceType);
        },
    });

    const { downloadedResources } = useDownloadedResource();

    const handleDownload = (resource: any) => {
        console.log(resource);
        vscode.postMessage({
            type: MessageType.DOWNLOAD_RESOURCE,
            payload: {
                resource: {
                    ...resource,
                    isChecked: true,
                },
            },
        });
    };

    const handleOpenResource = (resource: any) => {
        vscode.postMessage({
            type: MessageType.OPEN_RESOURCE,
            payload: {
                resource: {
                    ...resource,
                    isChecked: true,
                },
            },
        });
    };

    console.log("resources", resources?.[0]);

    return (
        <div>
            <div className="flex justify-center gap-3">
                Main Resources
                {RESOURCE_TYPES.map((type) => (
                    <VSCodeButton onClick={() => setResourceType(type.key)}>
                        {type.label}
                    </VSCodeButton>
                ))}
            </div>
            <table className="table-auto">
                <thead>
                    <tr>
                        <td>Resource</td>
                        <td>Type</td>
                        <td>Organization</td>
                        <td>Version</td>
                        <td></td>
                    </tr>
                </thead>

                <tbody className="gap-3">
                    {resources?.map((resource: any) => (
                        <tr>
                            <td>{resource.name}</td>
                            <td>{resource.subject}</td>
                            <td>{resource.owner}</td>
                            <td>{`${resource.released.split("T")[0]} (${
                                resource.release.tag_name
                            })`}</td>
                            <td>
                                {downloadedResources.find(
                                    (item) => item.id === resource.id,
                                ) ? (
                                    <button
                                        onClick={() =>
                                            handleOpenResource(
                                                downloadedResources.find(
                                                    (item) =>
                                                        item.id === resource.id,
                                                ),
                                            )
                                        }
                                    >
                                        Open
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleDownload(resource)}
                                    >
                                        Download
                                    </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default ResourcesTable;
