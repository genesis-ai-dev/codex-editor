export enum MessageType {
    showDialog = "showDialog",
    save = "save",
    openFile = "openFile",
    OPEN_RESOURCE = "openResource",
    createProject = "createProject",
    createObsProject = "createObsProject",
    openStory = "openStory",
    DOWNLOAD_RESOURCE = "downloadResource",
    SYNC_DOWNLOADED_RESOURCES = "syncDownloadedResources",
    TEST_MESSAGE = "testMessage",
    SEARCH_QUERY = "searchQuery",
    SEARCH_RESULTS = "searchResults",
    changeTnAcademyResource = "changeTnAcademyResource",
    SYNC_TA_FOLDERS = "syncTaFolders",
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

export type AnyObject = {
    [key: string]: any;
};
