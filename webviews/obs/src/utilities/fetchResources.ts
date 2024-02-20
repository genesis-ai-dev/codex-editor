import {
  TRANSLATION_RESOURCE_TYPES,
  fetchTranslationResource,
} from "./fetchTranslationResource";
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Language = {
  lc: string;
  code?: string;
  ld: string;
  alt: string[];
  hc: string;
  ln: string;
  ang: string;
  lr: string;
  pk: number;
  gw: boolean;
  cc: string[];
};

export type Copyright = {
  title: string;
  id: string;
  licence: string;
  locked: boolean;
};

export const environment = {
  PROJECT_SETTING_FILE: "scribe-settings.json",
  USER_SETTING_FILE: "scribe-user-settings.json",
  production: false,
  AG_SETTING_VERSION: "1.2.2",
  AG_USER_SETTING_VERSION: "1.2.0",
  APPLICATION_ID: "AutographaEditor",
  JAVASCRIPT_KEY: "C3925DFBCF06DF5291AC",
  SERVER_URL: "http://dev.autographa.org:1337/parse",
  GITEA_SERVER: "https://git.door43.org",
  GITEA_TOKEN: "Gitea AG Testing",
  GITEA_API_ENDPOINT: "https://git.door43.org/api/v1",
  uuidToken: "6223f833-3e59-429c-bec9-16910442b599",
  SYNC_BACKUP_COUNT: 5,
  AG_MINIMUM_BURRITO_VERSION: "0.3.0",
  OBS_IMAGE_DIR: "obs-images",
  MERGE_DIR_NAME: ".merge-staging-area",
  SCRIBE_SUPPORT_MAIL: "scribe@bridgeconn.com",
};

const fetchResource = async (
  filter: boolean,
  selectedLangFilter: Language[],
  selectedTypeFilter: {
    id: number;
    name: string;
  }[],
  selectResource:
    | "bible"
    | "obs"
    | (typeof TRANSLATION_RESOURCE_TYPES)[number]["key"]
) => {
  if (!["obs", "bible"].includes(selectResource)) {
    return fetchTranslationResource(
      selectResource as (typeof TRANSLATION_RESOURCE_TYPES)[number]["key"]
    );
  }

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
  return data?.data;
};

export default fetchResource;
