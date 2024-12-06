import { createMachine, assign, setup } from "xstate";

export enum StartupFlowStates {
    LOGIN_REGISTER = "loginRegister",
    OPEN_OR_CREATE_PROJECT = "createNewProject",
    PROMPT_USER_TO_INITIALIZE_PROJECT = "promptUserToInitializeProject",
    ALREADY_WORKING = "alreadyWorking",
}

export enum StartupFlowEvents {
    AUTH_LOGGED_IN = "AUTH_LOGGED_IN",
    NO_AUTH_EXTENSION = "NO_AUTH_EXTENSION",
    SKIP_AUTH = "SKIP_AUTH",
    PROJECT_CREATE_EMPTY = "PROJECT_CREATE_EMPTY",
    PROJECT_CLONE_OR_OPEN = "PROJECT_CLONE_OR_OPEN",
    BACK_TO_LOGIN = "BACK_TO_LOGIN",
    UPDATE_AUTH_STATE = "UPDATE_AUTH_STATE",
    INITIALIZE_PROJECT = "INITIALIZE_PROJECT",
    EMPTY_WORKSPACE_THAT_NEEDS_PROJECT = "EMPTY_WORKSPACE_THAT_NEEDS_PROJECT",
    VALIDATE_PROJECT_IS_OPEN = "VALIDATE_PROJECT_IS_OPEN",
}

type StartupFlowContext = {
    authState: {
        isAuthenticated: boolean;
        isAuthExtensionInstalled: boolean;
        isLoading: boolean;
        error: undefined | string;
        gitlabInfo: undefined | any; // Replace 'any' with specific type if available
    };
};

type StartupFlowEvent =
    | {
          type:
              | StartupFlowEvents.UPDATE_AUTH_STATE
              | StartupFlowEvents.AUTH_LOGGED_IN
              | StartupFlowEvents.NO_AUTH_EXTENSION;
          data: StartupFlowContext["authState"];
      }
    | {
          type:
              | StartupFlowEvents.SKIP_AUTH
              | StartupFlowEvents.PROJECT_CREATE_EMPTY
              | StartupFlowEvents.PROJECT_CLONE_OR_OPEN
              | StartupFlowEvents.BACK_TO_LOGIN;
      }
    | {
          type: StartupFlowEvents.INITIALIZE_PROJECT;
      }
    | {
          type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN;
      }
    | {
          type: StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT;
      };

export const startupFlowMachine = setup({
    types: {} as {
        context: StartupFlowContext;
        events: StartupFlowEvent;
    },
    actions: {
        updateAuthState: assign({
            authState: ({ event }) => {
                console.log("UPDATE_AUTH_STATE event:", event);
                return "data" in event ? event.data : undefined!;
            },
        }),
    },
}).createMachine({
    id: "startupFlow",
    initial: StartupFlowStates.LOGIN_REGISTER,
    context: {
        authState: {
            isAuthenticated: false,
            isAuthExtensionInstalled: false,
            isLoading: true,
            error: undefined,
            gitlabInfo: undefined,
        },
    },
    states: {
        [StartupFlowStates.LOGIN_REGISTER]: {
            on: {
                [StartupFlowEvents.UPDATE_AUTH_STATE]: {
                    actions: "updateAuthState",
                },
                [StartupFlowEvents.AUTH_LOGGED_IN]: {
                    target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                    actions: "updateAuthState",
                },
                [StartupFlowEvents.NO_AUTH_EXTENSION]: {
                    target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                    actions: "updateAuthState",
                },
                [StartupFlowEvents.SKIP_AUTH]: {
                    target: StartupFlowStates.OPEN_OR_CREATE_PROJECT,
                },
                [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]: {
                    target: StartupFlowStates.ALREADY_WORKING,
                },
            },
        },
        [StartupFlowStates.OPEN_OR_CREATE_PROJECT]: {
            on: {
                [StartupFlowEvents.BACK_TO_LOGIN]: StartupFlowStates.LOGIN_REGISTER,
                [StartupFlowEvents.PROJECT_CREATE_EMPTY]: StartupFlowStates.ALREADY_WORKING,
                [StartupFlowEvents.PROJECT_CLONE_OR_OPEN]: StartupFlowStates.ALREADY_WORKING,
                [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]: StartupFlowStates.ALREADY_WORKING,
                [StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT]:
                    StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT,
            },
        },
        [StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT]: {
            on: {
                [StartupFlowEvents.INITIALIZE_PROJECT]: StartupFlowStates.ALREADY_WORKING,
                [StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN]: StartupFlowStates.ALREADY_WORKING,
            },
        },
        [StartupFlowStates.ALREADY_WORKING]: {
            type: "final",
        },
    },
});
