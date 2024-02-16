export enum MessageType {
    showDialog = "showDialog",
    save = "save",
    openFile = "openFile",
    OPEN_RESOURCE = "openResource",
    createProject = "createProject",
    openStory = "openStory",
    DOWNLOAD_RESOURCE = "downloadResource",
    SYNC_DOWNLOADED_RESOURCES = "syncDownloadedResources",
    TEST_MESSAGE = "testMessage",
    SEARCH_QUERY = "searchQuery",
    SEARCH_RESULTS = "searchResults",
    createNewProject = "createNewProject",
}

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

export type DownloadedResource = {
    name: string;
    id: string;
    // uri: Record<string, any>;
    type: "obs" | "bible";
};
