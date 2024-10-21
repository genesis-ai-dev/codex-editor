import { environment } from "./fetchResources";

export const TRANSLATION_RESOURCE_TYPES = [
    {
        label: "Translation Notes",
        key: "tn",
        url_component: "TSV Translation Notes",
    },
    {
        label: "Translation Words",
        key: "tw",
        url_component: "Translation Words",
    },
    {
        label: "Translation Words Lists",
        key: "twl",
        url_component: "TSV Translation Words Links",
    },
    {
        label: "Translation Questions",
        key: "tq",
        url_component: "Translation Questions&subject=tsv Translation Questions",
    },
    {
        label: "OBS Translation Notes",
        key: "obs-tn",
        url_component: "OBS Translation Notes&subject=tsv obs Translation notes",
    },
    {
        label: "OBS Translation Questions",
        key: "obs-tq",
        url_component: "OBS Translation Questions&subject=tsv obs Translation Questions",
    },
    {
        label: "OBS Translation Words Lists",
        key: "obs-twl",
        url_component: "TSV OBS Translation Words Links",
    },
    {
        label: "Translation Academy",
        key: "ta",
        url_component: "Translation Academy&subject=tsv Translation Academy",
    },
] as const;

export const fetchTranslationResource = async (
    resourceKey: (typeof TRANSLATION_RESOURCE_TYPES)[number]["key"]
) => {
    const urlComponent = TRANSLATION_RESOURCE_TYPES.find((resource) => resource.key === resourceKey)
        ?.url_component;
    const baseUrl = `${environment.GITEA_API_ENDPOINT}/catalog/search?metadataType=rc&`;
    const url = `${baseUrl}subject=${urlComponent}`;
    // Allow pre production
    // if (selectedPreProd) {
    //     url += "&stage=preprod";
    //   }
    try {
        const fetchedData = await fetch(url);
        const fetchedJson = await fetchedData.json();
        return fetchedJson.data;
    } catch (err) {
        console.error(err);
        return null;
    }
};
