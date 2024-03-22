import React, { useEffect, useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import { useDownloadedResource } from "../hooks/useDownloadedResources";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { vscode } from "../utilities/vscode";
import { DownloadedResource, MessageType } from "../types";
import { RESOURCE_TYPES, handleOrgImage } from "../utilities/resources";

const DownloadedResources = () => {
    const { downloadedResources } = useDownloadedResource();

    return (
        <table className="table-auto w-full">
            <thead className="font-semibold">
                <tr>
                    <td>Resource</td>
                    <td>Type</td>
                    <td>Organization</td>
                    <td>Version</td>
                    <td></td>
                </tr>
            </thead>
            <tbody className="gap-3">
                {downloadedResources?.map((resource) => (
                    <DownloadedResourceTableRow resource={resource} />
                ))}
            </tbody>
        </table>
    );
};

const DownloadedResourceTableRow = ({
    resource,
}: {
    resource: DownloadedResource;
}) => {
    const handleOpenResource = (resource: DownloadedResource) => {
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

    const [extendedResource, setExtendedResource] = useState<Record<
        string,
        any
    > | null>(null);

    useEffect(() => {
        fetch(resource.remoteUrl).then(async (res) => {
            const data = await res.json();
            setExtendedResource(data);
        });
    });
    return (
        <tr>
            <td>{resource.name}</td>

            <td>
                {
                    RESOURCE_TYPES.find((type) => type.key === resource.type)
                        ?.label
                }
            </td>
            <td>
                {handleOrgImage(extendedResource?.owner) !== "" ? (
                    <img
                        src={handleOrgImage(extendedResource?.owner)}
                        alt={extendedResource?.owner}
                        className="w-8 h-8 rounded-lg object-contain"
                    />
                ) : (
                    extendedResource?.owner
                )}
            </td>
            <td
                title={`Released on : ${new Date(extendedResource?.released).toLocaleDateString()}`}
            >
                {resource.version}
            </td>
            <td className="flex items-center justify-center px-2">
                <VSCodeButton
                    title="Open Resource"
                    appearance="primary"
                    className="w-full"
                    onClick={() => handleOpenResource(resource)}
                >
                    <i className="codicon codicon-eye"></i>
                </VSCodeButton>
            </td>
        </tr>
    );
};

renderToPage(<DownloadedResources />);
