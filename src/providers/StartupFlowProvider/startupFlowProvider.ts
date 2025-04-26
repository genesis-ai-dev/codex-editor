            case "project.triggerSync":
                // Trigger a sync operation via the SyncManager
                try {
                    // Destructure message for type safety
                    const { message: commitMessage = "Sync after login" } = message;
                    
                    // Execute the sync command which is registered in syncManager.ts
                    vscode.commands.executeCommand(
                        "codex-editor-extension.triggerSync", 
                        commitMessage
                    );
                } catch (error) {
                    console.error("Error triggering sync:", error);
                }
                break; 