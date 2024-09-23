/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import fetchResource, { resourceOrgIcons } from "../utilities/fetchResources";
import { vscode } from "../utilities/vscode";
import { useDownloadedResource } from "../hooks/useDownloadedResources";
import { useState } from "react";
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { MessageType } from "../types";
import { RESOURCE_TYPES } from "../utilities/resources";

const ResourcesTable = () => {
    const [resourceType, setResourceType] = useState<(typeof RESOURCE_TYPES)[number]["key"]>("obs");
    const { data: resources } = useQuery({
        queryKey: ["resources", resourceType],
        queryFn: () => {
            return fetchResource(false, [], [], resourceType);
        },
    });

    const { downloadedResources } = useDownloadedResource();

    const sortedResources = resources
        ?.map((resource: any) => {
            return {
                ...resource,
                isDownloaded: downloadedResources.some((item) => item.id === resource.id),
            };
        })
        .sort((a: any, b: any) => {
            // Sort downloaded resources first
            if (a.isDownloaded && !b.isDownloaded) {
                return -1;
            } else if (!a.isDownloaded && b.isDownloaded) {
                return 1;
            }
            return 0;
        });

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

    const handleOrgImage = (organization: string) => {
        let icon = "";
        resourceOrgIcons.forEach((org) => {
            if (org.org === organization) {
                icon = org.icon;
            }
        });
        return icon;
    };

    return (
        <div>
            <div className="flex justify-between w-full">
                Filter Resources
                <VSCodeDropdown className="w-1/2">
                    {RESOURCE_TYPES.map((type) => (
                        <VSCodeOption onClick={() => setResourceType(type.key)}>
                            {type.label}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
            </div>
            <table className="table-auto w-full">
                <thead className="font-semibold">
                    <tr>
                        <td>Resource</td>
                        <td>Organization</td>
                        <td>Version</td>
                        <td></td>
                    </tr>
                </thead>

                <tbody className="gap-3">
                    {sortedResources?.map((resource: any) => (
                        <tr>
                            <td>{resource.language_title}</td>

                            <td>
                                {handleOrgImage(resource.owner) !== "" ? (
                                    <img
                                        src={handleOrgImage(resource.owner)}
                                        alt={resource.owner}
                                        className="w-8 h-8 rounded-lg object-contain"
                                    />
                                ) : (
                                    resource.owner
                                )}
                            </td>
                            <td
                                title={`Released on : ${new Date(resource.released).toLocaleDateString()}`}
                            >
                                {resource.release.tag_name}
                            </td>
                            <td className="flex items-center justify-center px-2">
                                {downloadedResources.find((item) => item.id === resource.id) ? (
                                    <VSCodeButton
                                        title="Open Resource"
                                        appearance="primary"
                                        className="w-full"
                                        onClick={() =>
                                            handleOpenResource(
                                                downloadedResources.find(
                                                    (item) => item.id === resource.id
                                                )
                                            )
                                        }
                                    >
                                        <i className="codicon codicon-eye"></i>
                                    </VSCodeButton>
                                ) : (
                                    <VSCodeButton
                                        title="Download Resource"
                                        appearance="secondary"
                                        className="w-full"
                                        onClick={() => handleDownload(resource)}
                                    >
                                        <i className="codicon codicon-cloud-download"></i>
                                    </VSCodeButton>
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
