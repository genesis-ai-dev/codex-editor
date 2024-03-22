import { resourceOrgIcons } from "./fetchResources";
import { TRANSLATION_RESOURCE_TYPES } from "./fetchTranslationResource";

export const RESOURCE_TYPES = [
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

export const handleOrgImage = (organization: string) => {
    const icon =
        resourceOrgIcons.find((org) => org.org === organization)?.icon || "";
    return icon;
};
