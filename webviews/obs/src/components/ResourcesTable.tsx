/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from "@tanstack/react-query";
import fetchResource from "../utilities/fetchResources";
import { vscode } from "../utilities/vscode";
import { MessageType } from "@/types";
import { useDownloadedResource } from "../hooks/useDownloadedResources";

const ResourcesTable = () => {
    const { data } = useQuery({
        queryKey: ["resources"],
        queryFn: () => {
            return fetchResource(false, [], [], "obs");
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

    return (
        <div>
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
                    {data?.data?.map((resource: any) => (
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
