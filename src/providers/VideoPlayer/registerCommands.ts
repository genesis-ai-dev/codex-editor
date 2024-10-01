import * as vscode from "vscode";
import { VideoPlayerProvider } from "./VideoPlayerProvider";
import { getWorkSpaceFolder } from "../../utils";

export const registerVideoPlayerCommands = (context: vscode.ExtensionContext) => {
    // Register the custom editor provider for video playback
    const videoEditorProvider = new VideoPlayerProvider(context);
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            VideoPlayerProvider.viewType,
            videoEditorProvider,
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        )
    );

    // Register a command to open the video player
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-video-player.openVideoPlayer", (uri: vscode.Uri) => {
            const workspaceFolder = getWorkSpaceFolder();
            if (workspaceFolder) {
                vscode.commands.executeCommand(
                    "vscode.openWith",
                    uri,
                    VideoPlayerProvider.viewType
                );
            }
        })
    );
};
