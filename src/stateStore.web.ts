import * as vscode from "vscode";
import { CellIdGlobalState, SelectedTextDataWithContext } from "../types";
type StateStoreUpdate =
    | { key: "cellId"; value: CellIdGlobalState }
    | { key: "uri"; value: string | null }
    | { key: "currentLineSelection"; value: SelectedTextDataWithContext }
    | { key: "plainTextNotes"; value: string }
    | { key: "apiKey"; value: string }
    | { key: "verseRef"; value: { verseRef: string; uri: string } }
    | { key: "cellId"; value: CellIdGlobalState }
    | {
          key: "sourceCellMap";
          value: { [k: string]: { content: string; versions: string[] } };
      };

type StateStoreKey = StateStoreUpdate["key"];
type StateStoreValue<K extends StateStoreKey> = Extract<StateStoreUpdate, { key: K }>["value"];

const extensionId = "project-accelerate.shared-state-store";

type DisposeFunction = () => void;
export async function initializeStateStore() {
    let storeListener: <K extends StateStoreKey>(
        keyForListener: K,
        callBack: (value: StateStoreValue<K> | undefined) => void
    ) => DisposeFunction = () => () => undefined;

    let updateStoreState: (update: StateStoreUpdate) => void = () => undefined;
    let getStoreState: <K extends StateStoreKey>(
        key: K
    ) => Promise<StateStoreValue<K> | undefined> = () => Promise.resolve(undefined);

    console.log(`[Web] Attempting to access ${extensionId} extension...`);
    
    // Try multiple approaches to find the extension
    let extension = vscode.extensions.getExtension(extensionId);
    
    // If not found, check if it's available but under a different ID format
    if (!extension) {
        console.log(`[Web] Extension not found with ID ${extensionId}, checking all extensions...`);
        const allExtensions = vscode.extensions.all;
        console.log(`[Web] Available extensions: ${allExtensions.map(ext => ext.id).join(', ')}`);
        
        // Look for extensions that might match by partial ID
        const possibleMatches = allExtensions.filter(ext => 
            ext.id.includes('shared-state-store') || 
            ext.id.toLowerCase().includes('shared-state-store')
        );
        
        if (possibleMatches.length > 0) {
            console.log(`[Web] Found possible matches: ${possibleMatches.map(ext => ext.id).join(', ')}`);
            extension = possibleMatches[0];
        }
    }
    
    if (extension) {
        console.log(`[Web] Found ${extension.id} extension, activating...`);
        try {
            const api = await extension.activate();
            if (!api) {
                console.error(`[Web] Extension ${extension.id} does not expose an API.`);
                // Only show error in development environments, not for end users
                if (process.env.NODE_ENV === 'development') {
                    vscode.window.showErrorMessage(`Shared State Store extension found but does not expose an API. Some features may not work correctly.`);
                }
            } else {
                console.log(`[Web] Successfully activated ${extension.id} extension`);
                storeListener = api.storeListener;
                updateStoreState = api.updateStoreState;
                getStoreState = api.getStoreState;
                return {
                    storeListener,
                    updateStoreState,
                    getStoreState,
                };
            }
        } catch (error) {
            console.error(`[Web] Error activating ${extension.id}:`, error);
            // Only show error in development environments, not for end users
            if (process.env.NODE_ENV === 'development') {
                vscode.window.showErrorMessage(`Error activating Shared State Store extension: ${error}. Some features may not work correctly.`);
            }
        }
    } else {
        console.error(`[Web] Extension ${extensionId} not found.`);
        // Only show error in development environments, not for end users
        if (process.env.NODE_ENV === 'development') {
            vscode.window.showErrorMessage(`Shared State Store extension not found. Please make sure it is installed and enabled.`);
        }
    }
    
    // Return empty implementation if the extension couldn't be loaded or activated
    console.log(`[Web] Returning empty implementation for state store`);
    return {
        storeListener,
        updateStoreState,
        getStoreState,
    };
} 