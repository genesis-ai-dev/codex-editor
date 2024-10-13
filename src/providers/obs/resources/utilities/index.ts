import { ResourceMetadata } from "../types";

export const getResourceType = (subject: string) => {
    if (subject === "Open Bible Stories") return "obs";
    if (subject === "Bible") return "bible";
    if (subject === "TSV Translation Notes") return "tn";
    if (subject === "Translation Academy") return "ta";
    if (subject === "Translation Questions") return "tq";
    if (subject === "TSV Translation Questions") return "tq";
    if (subject === "Translation Words") return "tw";
    if (subject === "TSV Translation Words Links") return "twl";
    if (subject === "OBS Translation Notes" || subject === "TSV OBS Translation Notes")
        return "obs-tn";
    if (subject === "OBS Translation Questions") return "obs-tq";
    if (subject === "TSV OBS Translation Questions") return "obs-tq";
    if (subject === "OBS Translation Words Links" || subject === "TSV OBS Translation Words Links")
        return "obs-twl";
    throw new Error("Invalid resource type");
};

export const getLinkedTwResource = async (resourceMetadata: ResourceMetadata) => {
    const lang = resourceMetadata.meta.language;
    const owner = resourceMetadata.meta.owner;

    const baseUrl = `${environment.GITEA_API_ENDPOINT}/catalog/search?metadataType=rc&`;
    const url = `${baseUrl}subject=Translation Words&lang=${lang}`;

    const fetchedData = await fetch(url);
    const fetchedJson = await fetchedData.json();

    const resources = fetchedJson.data as ResourceMetadata["meta"][];

    if (resources.length === 0) {
        return null;
    }

    if (resources.length === 1) {
        return resources[0];
    }

    const linkedResource = resources.find((resource) => resource.owner === owner);

    return linkedResource ?? resources[0];
};
export const environment = {
    GITEA_SERVER: "https://git.door43.org",
    GITEA_TOKEN: "Gitea AG Testing",
    GITEA_API_ENDPOINT: "https://git.door43.org/api/v1",
};
