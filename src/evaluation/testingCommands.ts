import * as vscode from "vscode";
import { GlobalProvider } from "../globalProvider";
import { runAutomatedTest, selectRandomCells, TestSummary } from "./testingSuite";

type SnapshotSections = "codex-editor-extension" | "codex-project-manager" | string;

async function ensureDir(uri: vscode.Uri) {
	try {
		await vscode.workspace.fs.stat(uri);
	} catch {
		await vscode.workspace.fs.createDirectory(uri);
	}
}

async function writeJson(uri: vscode.Uri, data: unknown) {
	const enc = new TextEncoder();
	await vscode.workspace.fs.writeFile(uri, enc.encode(JSON.stringify(data, null, 2)));
}

async function readJson<T>(uri: vscode.Uri): Promise<T | null> {
	try {
		const buf = await vscode.workspace.fs.readFile(uri);
		const dec = new TextDecoder();
		return JSON.parse(dec.decode(buf)) as T;
	} catch {
		return null;
	}
}

function pickSettings(section: SnapshotSections, keys: string[]) {
	const conf = vscode.workspace.getConfiguration(section);
	const out: Record<string, unknown> = {};
	for (const key of keys) {
		out[key] = conf.get(key);
	}
	return out;
}

function mapSourceUriToTargetUri(sourceUriStr: string): vscode.Uri | null {
	try {
		const ws = vscode.workspace.workspaceFolders?.[0];
		if (!ws) return null;
		const parsed = vscode.Uri.parse(sourceUriStr);
		const fileName = parsed.path.split("/").pop() || "";
		if (!fileName.toLowerCase().endsWith(".source")) return null;
		const targetFile = fileName.replace(/\.source$/i, ".codex");
		return vscode.Uri.joinPath(ws.uri, "files", "target", targetFile);
	} catch {
		return null;
	}
}

export function registerTestingCommands(context: vscode.ExtensionContext) {
	console.log('[testingCommands] Registering testing commands...');
	const snapshotCmd = vscode.commands.registerCommand("codex-testing.snapshotConfig", async () => {
		const ws = vscode.workspace.workspaceFolders?.[0];
		if (!ws) {
			vscode.window.showErrorMessage("Open a workspace to snapshot settings.");
			return;
		}

		const baseDir = vscode.Uri.joinPath(ws.uri, ".codex", "automated-tests");
		const configsDir = vscode.Uri.joinPath(baseDir, "configurations");
		await ensureDir(baseDir);
		await ensureDir(configsDir);

		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const file = vscode.Uri.joinPath(configsDir, `config-${timestamp}.json`);

		const editorKeys = [
			"llmEndpoint",
			"api_key",
			"model",
			"customModel",
			"contextSize",
			"additionalResourcesDirectory",
			"experimentalContextOmission",
			"sourceBookWhitelist",
			"temperature",
			"main_chat_language",
			"chatSystemMessage",
			"numberOfFewShotExamples",
			"debugMode",
			"useOnlyValidatedExamples",
			"abTestingVariants",
			"allowHtmlPredictions",
		];

		const projectKeys = [
			"sourceLanguage",
			"targetLanguage",
			"validationCount",
			"spellcheckIsEnabled",
			"projectName",
			"abbreviation",
			"userName",
			"userEmail",
			"watchedFolders",
			"projectHistory",
		];

		const snapshot = {
			createdAt: timestamp,
			sections: {
				"codex-editor-extension": pickSettings("codex-editor-extension", editorKeys),
				"codex-project-manager": pickSettings("codex-project-manager", projectKeys),
			},
		};

		await writeJson(file, snapshot);
		vscode.window.showInformationMessage(`Saved configuration snapshot: ${file.fsPath}`);
		return file.fsPath;
	});

	// Main test command - unified flow for single or batch
	const runTestCmd = vscode.commands.registerCommand(
		"codex-testing.runTest",
		async (args?: { cellIds?: string[]; count?: number; onlyValidated?: boolean; }) => {
			let cellIds = args?.cellIds || [];
			const count = args?.count || 10;
			const onlyValidated = args?.onlyValidated || false;

			// If no specific cells provided, select random ones
			if (cellIds.length === 0) {
				cellIds = await selectRandomCells(count, onlyValidated);
				if (cellIds.length === 0) {
					vscode.window.showErrorMessage("No cells found matching criteria.");
					return null;
				}
			}

			// Run the test with progress
			return await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Running translation test on ${cellIds.length} cells...`,
					cancellable: false
				},
				async (progress) => {
					const result = await runAutomatedTest(cellIds, (message, percent) => {
						progress.report({ message, increment: percent });
					});
					vscode.window.showInformationMessage(
						`Test complete! Average CHRF: ${result.averageCHRF.toFixed(3)} (${result.cellCount} cells)`
					);
					return result;
				}
			);
		}
	);

	// List historical tests
	const listHistoryCmd = vscode.commands.registerCommand("codex-testing.getTestHistory", async () => {
		const ws = vscode.workspace.workspaceFolders?.[0];
		if (!ws) return [];
		const baseDir = vscode.Uri.joinPath(ws.uri, ".codex", "automated-tests");
		try {
			const entries = await vscode.workspace.fs.readDirectory(baseDir);
			const files = entries
				.filter(([name, type]) => type === vscode.FileType.File && /^test-.*\.json$/i.test(name))
				.map(([name]) => vscode.Uri.joinPath(baseDir, name));
			const items: Array<{ path: string; testId: string; timestamp: string; averageCHRF: number; cellCount: number; }>= [];
			for (const file of files) {
				const data = await readJson<TestSummary>(file);
				if (data) items.push({ path: file.fsPath, testId: data.testId, timestamp: data.timestamp, averageCHRF: data.averageCHRF, cellCount: data.cellCount });
			}
			// Sort by timestamp desc
			items.sort((a, b) => (new Date(b.timestamp).getTime()) - (new Date(a.timestamp).getTime()));
			return items;
		} catch {
			return [];
		}
	});

	// Load a specific test file
	const loadTestCmd = vscode.commands.registerCommand("codex-testing.loadTest", async (pathOrUri: string | vscode.Uri) => {
		try {
			const uri = typeof pathOrUri === "string" ? vscode.Uri.file(pathOrUri) : pathOrUri;
			const data = await readJson<TestSummary>(uri);
			return data;
		} catch {
			return null;
		}
	});

	// Reapply config from a test summary's snapshot path
	const reapplyCmd = vscode.commands.registerCommand("codex-testing.reapplyConfigForTest", async (pathOrUri: string | vscode.Uri) => {
		const summary = await vscode.commands.executeCommand<TestSummary | null>("codex-testing.loadTest", pathOrUri);
		if (!summary) {
			vscode.window.showErrorMessage("Failed to load test summary.");
			return false;
		}
		// summary.configSnapshot is a path string to a config JSON
		const snapshotPath = typeof summary.configSnapshot === "string" ? summary.configSnapshot : "";
		if (!snapshotPath) {
			vscode.window.showErrorMessage("No configuration snapshot found in test summary.");
			return false;
		}
		try {
			const snapshot = await readJson<{ createdAt: string; sections: Record<string, Record<string, any>>; }>(vscode.Uri.file(snapshotPath));
			if (!snapshot) throw new Error("Snapshot file not found");
			// Apply settings
			for (const [section, kv] of Object.entries(snapshot.sections || {})) {
				const config = vscode.workspace.getConfiguration(section);
				for (const [key, value] of Object.entries(kv)) {
					await config.update(key, value, vscode.ConfigurationTarget.Workspace);
				}
			}
			vscode.window.showInformationMessage("Configuration reapplied from snapshot.");
			return true;
		} catch (e) {
			vscode.window.showErrorMessage(`Failed to reapply configuration: ${e instanceof Error ? e.message : String(e)}`);
			return false;
		}
	});

	// Delete a test file
	const deleteTestCmd = vscode.commands.registerCommand("codex-testing.deleteTest", async (pathOrUri: string | vscode.Uri) => {
		console.log('[testingCommands] deleteTest command called with:', pathOrUri);
		try {
			const uri = typeof pathOrUri === "string" ? vscode.Uri.file(pathOrUri) : pathOrUri;
			console.log('[testingCommands] Attempting to delete file at URI:', uri.toString());
			await vscode.workspace.fs.delete(uri);
			console.log('[testingCommands] File deleted successfully');
			return true;
		} catch (e) {
			console.error('[testingCommands] Failed to delete test file:', e);
			return false;
		}
	});

	context.subscriptions.push(snapshotCmd, runTestCmd, listHistoryCmd, loadTestCmd, reapplyCmd, deleteTestCmd);
	console.log('[testingCommands] All testing commands registered successfully, including deleteTest');
}


