import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

/**
 * Migrates metadata.json terminology from "healing" to "updating"
 * TODO: REMOVE IN 0.17.0 - This migration is only needed for versions 0.13.0-0.16.x
 */
export async function migration_healingToUpdating(projectPath: string): Promise<void> {
    console.log("=".repeat(80));
    console.log("🔄 MIGRATION STARTED: Healing → Updating terminology");
    console.log("=".repeat(80));
    console.log(`[Migration] Project path: ${projectPath}`);
    
    // TODO: REMOVE IN 0.17.0 - Version gate for migration
    // This migration only runs for versions 0.13.x, 0.14.x, 0.15.x, and 0.16.x
    
    // Get extension version using the same robust pattern as versionChecks.ts
    const codexExt = vscode.extensions.getExtension("project-accelerate.codex-editor-extension");
    console.log(`[Migration] Extension found:`, !!codexExt);
    
    const currentVersion: string | undefined = (codexExt as any)?.packageJSON?.version;
    console.log(`[Migration] Current version:`, currentVersion);
    
    if (currentVersion) {
        const versionParts = currentVersion.split('.');
        const major = parseInt(versionParts[0]);
        const minor = parseInt(versionParts[1]);
        
        console.log(`[Migration] Version parsed: major=${major}, minor=${minor}`);
        
        // Skip if version is 0.17.0 or higher (migration no longer needed)
        if (major > 0 || minor >= 17) {
            console.log(`[Migration] ⏭️ Skipping migration (version ${currentVersion} >= 0.17.0)`);
            return;
        }
        
        // Skip if version is below 0.13.0 (migration not yet relevant)
        if (major === 0 && minor < 13) {
            console.log(`[Migration] ⏭️ Skipping migration (version ${currentVersion} < 0.13.0)`);
            return;
        }
        
        console.log(`[Migration] ✅ Version ${currentVersion} is in migration range (0.13.0-0.16.x)`);
    } else {
        console.warn("[Migration] ⚠️ Could not determine Codex Editor version, proceeding with migration anyway");
    }
    
    const metadataPath = path.join(projectPath, "metadata.json");

    // Check if metadata.json exists
    if (!fs.existsSync(metadataPath)) {
        console.log(`[Migration] No metadata.json found at ${metadataPath}`);
        return;
    }

    try {
        const content = fs.readFileSync(metadataPath, "utf8");
        const metadata = JSON.parse(content);

        // Check if migration is needed
        const hasOldKey = metadata.meta?.initiateRemoteHealingFor;
        const hasNewKey = metadata.meta?.initiateRemoteUpdatingFor;

        console.log(`[Migration] Checking ${metadataPath}:`, {
            hasOldKey: !!hasOldKey,
            hasNewKey: !!hasNewKey,
            oldKeyLength: hasOldKey ? metadata.meta.initiateRemoteHealingFor.length : 0,
            newKeyLength: hasNewKey ? metadata.meta.initiateRemoteUpdatingFor.length : 0,
        });

        // If no old key and new key exists, already migrated
        if (!hasOldKey && hasNewKey) {
            console.log("[Migration] Already migrated - new key exists, old key absent");
            return;
        }

        // If no old key and no new key, nothing to migrate
        if (!hasOldKey && !hasNewKey) {
            console.log("[Migration] Nothing to migrate - neither key exists");
            return;
        }

        // Perform migration
        let needsSave = false;

        if (hasOldKey) {
            console.log(`[Migration] Migrating ${metadata.meta.initiateRemoteHealingFor.length} entries from initiateRemoteHealingFor to initiateRemoteUpdatingFor`);
            
            // Migrate the array
            const migratedEntries = metadata.meta.initiateRemoteHealingFor.map((entry: any) => {
                // Rename userToHeal → userToUpdate while preserving key order (userToUpdate at top)
                if ('userToHeal' in entry) {
                    const { userToHeal, deleted, deletedBy, obliterate, ...rest } = entry;
                    // Reconstruct with userToUpdate first (where userToHeal was)
                    // Also rename: deleted → cancelled, deletedBy → cancelledBy, obliterate → clearEntry
                    return {
                        userToUpdate: userToHeal,
                        ...rest,
                        cancelled: deleted !== undefined ? deleted : false,
                        cancelledBy: deletedBy !== undefined ? deletedBy : "",
                        ...(obliterate !== undefined && { clearEntry: obliterate })
                    };
                }

                // Note: Do NOT update updatedAt - only migrate keys
                return entry;
            });

            // Replace old key with new key
            metadata.meta.initiateRemoteUpdatingFor = migratedEntries;
            delete metadata.meta.initiateRemoteHealingFor;
            needsSave = true;
        }
        
        // Also migrate existing initiateRemoteUpdatingFor entries (deleted → cancelled, obliterate → clearEntry)
        if (metadata.meta?.initiateRemoteUpdatingFor && !hasOldKey) {
            const updatingList = metadata.meta.initiateRemoteUpdatingFor;
            let updatedAny = false;
            
            for (const entry of updatingList) {
                if (typeof entry === 'object' && entry !== null) {
                    // Migrate deleted → cancelled, deletedBy → cancelledBy, obliterate → clearEntry
                    if ('deleted' in entry && !('cancelled' in entry)) {
                        entry.cancelled = entry.deleted;
                        delete entry.deleted;
                        updatedAny = true;
                    }
                    if ('deletedBy' in entry && !('cancelledBy' in entry)) {
                        entry.cancelledBy = entry.deletedBy;
                        delete entry.deletedBy;
                        updatedAny = true;
                    }
                    if ('obliterate' in entry && !('clearEntry' in entry)) {
                        entry.clearEntry = entry.obliterate;
                        delete entry.obliterate;
                        updatedAny = true;
                    }
                }
            }
            
            if (updatedAny) {
                console.log(`[Migration] Migrated ${updatingList.length} entries: deleted → cancelled, deletedBy → cancelledBy, obliterate → clearEntry`);
                needsSave = true;
            }
        }

        if (needsSave) {
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
            console.log(`[Migration] ✅ Successfully updated metadata.json terminology: healing → updating (${projectPath})`);
            
            // Show user notification
            vscode.window.showInformationMessage(
                "✅ Project metadata updated: terminology migrated from 'healing' to 'updating'"
            );
        } else {
            console.log(`[Migration] No changes needed - metadata already up to date`);
        }
    } catch (error) {
        console.error(`[Migration] ❌ Failed to migrate metadata.json at ${projectPath}:`, error);
        // Don't throw - migration failures should not break the extension
    }
    
    console.log("=".repeat(80));
    console.log("🏁 MIGRATION COMPLETED");
    console.log("=".repeat(80));
}

