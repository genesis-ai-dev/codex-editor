import * as vscode from "vscode";
import { ResourcesProvider } from "./obs/resources/resourcesProvider";
import { StoryOutlineProvider } from "./obs/storyOutline/storyOutlineProvider";
import { ObsEditorProvider } from "./obs/editor/ObsEditorProvider";
import { TranslationNotesProvider } from "./translationNotes/TranslationNotesProvider";
import { DownloadedResourcesProvider } from "./downloadedResource/provider";
import { CodexCellEditorProvider } from "./codexCellEditorProvider/codexCellEditorProvider";
import { registerSourceControl } from "./sourceControl/sourceControlProvider";

export function registerProviders(context: vscode.ExtensionContext) {
    const disposables: vscode.Disposable[] = [];

    // Register ResourcesProvider
    disposables.push(ResourcesProvider.register(context));

    // Register StoryOutlineProvider
    disposables.push(StoryOutlineProvider.register(context));

    // Register ObsEditorProvider
    disposables.push(ObsEditorProvider.register(context));

    // Register TranslationNotesProvider
    const { providerRegistration, commandRegistration } =
        TranslationNotesProvider.register(context);
    disposables.push(providerRegistration, commandRegistration);

    // Register DownloadedResourcesProvider
    const downloadedResourcesDisposable = DownloadedResourcesProvider.register(context);
    if (downloadedResourcesDisposable) {
        disposables.push(downloadedResourcesDisposable);
    }

    // Register CodexCellEditorProvider
    disposables.push(CodexCellEditorProvider.register(context));

    // Register SourceControlProvider
    const sourceControlProvider = registerSourceControl(context);
    disposables.push(sourceControlProvider);

    // Add all disposables to the context subscriptions
    context.subscriptions.push(...disposables);
}
