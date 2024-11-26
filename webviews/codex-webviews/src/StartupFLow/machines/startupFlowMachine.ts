import { createMachine } from "xstate";

export const startupFlowMachine = createMachine({
    id: "startupFlow",
    initial: "loginRegister",
    context: {
        authState: {
            isAuthenticated: false,
            isAuthExtensionInstalled: false,
            isLoading: true,
            error: undefined,
            gitlabInfo: undefined
        },
        projectSelection: {
            type: undefined,
            path: undefined,
            repoUrl: undefined,
            error: undefined,
        },
        metadataExists: false,
    },
    states: {
        loginRegister: {
            on: {
                "AUTH.LOGGED_IN": "workspaceCheck",
                "AUTH.NO_EXTENSION": "workspaceCheck",
            },
        },
        workspaceCheck: {
            on: {
                "WORKSPACE.OPEN": "metadataCheck",
                "WORKSPACE.CLOSED": "createNewProject",
            },
        },
        createNewProject: {
            on: {
                "PROJECT.CREATE_EMPTY": "openSourceFlow",
                "PROJECT.CLONE": "alreadyWorking",
            },
        },
        metadataCheck: {
            on: {
                "METADATA.EXISTS": "alreadyWorking",
                "METADATA.NOT_EXISTS": "complicatedState",
            },
        },
        openSourceFlow: {
            // This is where the current 'initialize project' functionality lives
            on: {
                "SOURCE.INITIALIZED": "alreadyWorking",
            },
        },
        complicatedState: {
            // NOTE: You could get here if the user deletes the metadata file so we should add more logic here to check if it is just a missing metadata file or something more serious
            on: {
                "INIT.PROJECT": "openSourceFlow",
            },
        },
        alreadyWorking: {
            type: "final",
        },
    },
});
