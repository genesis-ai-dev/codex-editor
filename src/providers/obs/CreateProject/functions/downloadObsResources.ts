import { environment } from "../data/environment";
import { Language } from "../types";

const fetchResource = async (
    filter: boolean,
    selectedLangFilter: Language[],
    selectedTypeFilter: {
        id: number;
        name: string;
    }[],
    selectResource: "bible" | "obs",
) => {
    const subjectTypeArray = {
        bible: [
            { id: 1, name: "Aligned Bible" },
            { id: 2, name: "Bible" },
            // { id: 3, name: 'Hebrew Old Testament' },
            // { id: 4, name: 'Greek New Testament' },
        ],
        obs: [{ id: 1, name: "Open Bible Stories" }],
    };
    const baseUrl = `${environment.GITEA_API_ENDPOINT}/catalog/search?metadataType=rc`;
    let url = "";
    if (filter) {
        url = `${baseUrl}`;
        if (selectedLangFilter.length > 0) {
            selectedLangFilter.forEach((row) => {
                url += `&lang=${row?.lc ? row?.lc : row?.code}`;
            });
        }
        if (selectedTypeFilter.length > 0) {
            selectedTypeFilter.forEach((row: any) => {
                url += `&subject=${row.name}`;
            });
        } else {
            // nothing selected default will be bible || obs
            switch (selectResource) {
                case "bible":
                    url += "&subject=Bible";
                    break;
                case "obs":
                    url += `&subject=${subjectTypeArray.obs[0].name}`;
                    break;
                default:
                    break;
            }
        }
    } else {
        // initial load
        switch (selectResource) {
            case "bible":
                url = `${baseUrl}&subject=Bible&lang=en`;
                break;
            case "obs":
                url = `${baseUrl}&subject=${subjectTypeArray.obs[0].name}`;
                // add a lang param to the url if we want to filter by language
                break;
            default:
                break;
        }
    }
    const response = await fetch(url);
    const data = await response.json();
    return data;
};

export default fetchResource;
