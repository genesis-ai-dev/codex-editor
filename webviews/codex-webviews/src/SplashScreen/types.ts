// In SplashScreen/types.ts
export interface ActivationTiming {
    step: string;
    startTime: number;
    duration: number;
}

export interface SplashScreenMessage {
    command: "update" | "complete" | "animationComplete";
    timings?: ActivationTiming[];
}

// This should match the actual VSCode API that acquireVsCodeApi returns
export interface VSCodeAPI {
    postMessage(message: any): void;
    getState(): any;
    setState(state: any): void;
}

// Define initialState on the Window object
declare global {
    function acquireVsCodeApi(): VSCodeAPI;

    interface Window {
        initialState?: {
            timings: ActivationTiming[];
        };
    }
}
