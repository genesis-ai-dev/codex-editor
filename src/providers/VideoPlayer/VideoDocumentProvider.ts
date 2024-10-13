import * as vscode from "vscode";

class VideoDocumentProvider implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    provideTextDocumentContent(uri: vscode.Uri): string {
        console.log("provideTextDocumentContent called for video player", { uri });
        // Generate and return the content for the virtual video document
        // <!DOCTYPE html>
        // <html lang="en">
        // <head>
        //     <meta charset="UTF-8">
        //     <meta name="viewport" content="width=device-width, initial-scale=1.0">
        //     <title>Video Player</title>
        // </head>
        // <body>
        //     <video controls width="100%">
        //         <source src="${uri.toString()}" type="video/mp4">
        //         Your browser does not support the video tag.
        //     </video>
        // </body>
        // </html>
        return `Hello world`;
    }
}

export default VideoDocumentProvider;
