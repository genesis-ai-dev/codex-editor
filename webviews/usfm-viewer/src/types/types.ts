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
    SCROLL_TO_CHAPTER = "scrollToChapter",
    UPDATE_CHAPTER = "updateChapter",
    BLOCK_CLICK = "blockClick",
    SEND_BOOKS_IN_WORKSPACE = "sendBooksInWorkspace",
    BOOKS_IN_WORKSPACE_RESPONSE = "booksInWorkspaceResponse",
    OPEN_USFM_FILE = "openUsfmFile",
    GET_USFM = "get-usfm",
}

export interface BookPayload {
    book: string; //GEN
    bookName: string; //Genesis
    fileName: string; //GEN
}
