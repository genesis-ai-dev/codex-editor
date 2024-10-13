import * as vscode from "vscode";
import { ResourcesProvider } from "./obs/resources/resourcesProvider";
import { StoryOutlineProvider } from "./obs/storyOutline/storyOutlineProvider";
import { ObsEditorProvider } from "./obs/editor/ObsEditorProvider";
import { TranslationNotesProvider } from "./translationNotes/TranslationNotesProvider";
import { DownloadedResourcesProvider } from "./downloadedResource/provider";
import { CodexCellEditorProvider } from "./codexCellEditorProvider/codexCellEditorProvider";
import { registerSourceControl } from "./sourceControl/sourceControlProvider";

export function registerProviders(context: vscode.ExtensionContext) {
    // Register ResourcesProvider
    context.subscriptions.push(ResourcesProvider.register(context));

    // Register StoryOutlineProvider
    context.subscriptions.push(StoryOutlineProvider.register(context));

    // Register ObsEditorProvider
    context.subscriptions.push(ObsEditorProvider.register(context));

    // Register TranslationNotesProvider
    const { providerRegistration, commandRegistration } =
        TranslationNotesProvider.register(context);
    context.subscriptions.push(providerRegistration, commandRegistration);

    // Register DownloadedResourcesProvider
    DownloadedResourcesProvider.register(context);

    // Register CodexCellEditorProvider
    context.subscriptions.push(CodexCellEditorProvider.register(context));

    // Register SourceControlProvider
    const sourceControlProvider = registerSourceControl(context);
    context.subscriptions.push(sourceControlProvider);
}
