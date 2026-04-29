/**
 * Covers the NewSourceUploader flow: the "AI Translation Instructions" step (system message
 * with generate / save), appearing on "Start Translating" when AI project setup is incomplete;
 * skipping to open the codex when setup is complete; and using the latest import URI after a
 * second import ("Import More Files").
 */
import React from "react";
import { render, screen, waitFor, act, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom";
import type { NotebookPair } from "./types/common";
import type { ProcessedNotebookMetadata } from "./types/processedNotebookMetadata";
import type { ImporterComponentProps, ImporterPlugin } from "./types/plugin";

/** Minimal valid pair for exercising `handleComplete` / provider messages in tests. */
function stubNotebookPair(): NotebookPair {
    const metadata = (overrides: { id: string; sourceFile: string }): ProcessedNotebookMetadata =>
        ({
            id: overrides.id,
            originalFileName: "BookA",
            sourceFile: overrides.sourceFile,
            importerType: "plaintext",
            createdAt: "2020-01-01T00:00:00.000Z",
        }) as ProcessedNotebookMetadata;

    return {
        source: { name: "BookA", cells: [], metadata: metadata({ id: "stub-src", sourceFile: "BookA.source" }) },
        codex: { name: "BookA", cells: [], metadata: metadata({ id: "stub-cdx", sourceFile: "BookA.codex" }) },
    };
}

const hoisted = vi.hoisted(() => {
    const TestImporter = (props: ImporterComponentProps) => (
        <button
            type="button"
            data-testid="mock-import-complete"
            onClick={() => {
                if (!props.onComplete) {
                    throw new Error("TestImporter: onComplete is required for this test path");
                }
                props.onComplete(stubNotebookPair());
            }}
        >
            Complete import
        </button>
    );

    const testPlugin: ImporterPlugin = {
        id: "test-importer",
        name: "Test Importer",
        description: "Test-only stub importer",
        icon: () => null,
        component: TestImporter,
        enabled: true,
        supportedExtensions: [".txt"],
        tags: ["Essential", "Test"],
    };

    return { testPlugin, TestImporter };
});

vi.mock("./importers/registry.tsx", () => ({
    importerPlugins: [hoisted.testPlugin],
    getImporterById: (id: string) => (id === "test-importer" ? hoisted.testPlugin : undefined),
    getEssentialImporters: (targetOnly?: boolean) => (targetOnly ? [] : [hoisted.testPlugin]),
    getSpecializedImporters: () => [],
    searchPlugins: (query: string, plugins: ImporterPlugin[]) => {
        if (!query.trim()) {
            return plugins;
        }
        return plugins.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
    },
}));

vi.mock("./components/ExportOptionsPreviewPanel", () => ({
    ExportOptionsPreviewPanel: () => null,
}));

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
    VSCodeButton: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
        <button type="button" onClick={onClick} disabled={disabled}>
            {children}
        </button>
    ),
    VSCodeTextArea: ({ id, value, onInput, disabled, placeholder }: { id?: string; value?: string; onInput?: (e: { target: { value: string } }) => void; disabled?: boolean; placeholder?: string }) => (
        <textarea id={id} value={value} onChange={(e) => onInput?.(e as unknown as { target: { value: string } })} disabled={disabled} placeholder={placeholder} />
    ),
}));

function dispatchHostMessage(data: object): void {
    window.dispatchEvent(
        new MessageEvent("message", {
            bubbles: true,
            data,
        })
    );
}

describe("NewSourceUploader — Start Translating & AI Translation Instructions", () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let NewSourceUploader: React.FC;

    beforeAll(async () => {
        postMessage = vi.fn();
        (window as unknown as { vscodeApi: { postMessage: typeof postMessage } }).vscodeApi = {
            postMessage,
        };
        const mod = await import("./NewSourceUploader");
        NewSourceUploader = mod.default;
    });

    beforeEach(() => {
        postMessage.mockClear();
    });

    afterEach(() => {
        cleanup();
    });

    const inventoryWithSources = (count: number) => ({
        sourceFiles: Array.from({ length: count }, (_, i) => ({
            name: `Book${i}`,
            path: `file:///ws/.project/sourceTexts/Book${i}.source`,
            type: "usfm" as const,
            cellCount: 1,
        })),
        targetFiles: [] as { path: string; name: string }[],
        translationPairs: [] as { sourcePath: string; targetPath: string }[],
    });

    async function goToImportComplete(options: { codexUri: string; aiInstructionsCompleted: boolean }): Promise<void> {
        await act(async () => {
            dispatchHostMessage({
                command: "projectInventory",
                inventory: inventoryWithSources(1),
            });
        });

        await waitFor(() => {
            expect(screen.getByText("Test Importer")).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText("Test Importer"));
        });

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId("mock-import-complete"));
        });

        await act(async () => {
            dispatchHostMessage({
                command: "projectInventory",
                inventory: inventoryWithSources(1),
            });
            dispatchHostMessage({
                command: "importComplete",
                importedCodexUris: [options.codexUri],
                aiInstructionsCompleted: options.aiInstructionsCompleted,
            });
        });

        await waitFor(() => {
            const btn = screen.getByRole("button", { name: /Start Translating/i });
            expect(btn).not.toBeDisabled();
        });
    }

    it('shows "AI Translation Instructions" (system message step) when Start Translating runs and AI setup is not completed', async () => {
        render(<NewSourceUploader />);

        await goToImportComplete({
            codexUri: "file:///ws/files/First.codex",
            aiInstructionsCompleted: false,
        });

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /Start Translating/i }));
        });

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: /AI Translation Instructions/i })).toBeInTheDocument();
        });

        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: "metadata.check" })
        );
    });

    it('opens the imported codex file when AI setup is already completed; does not show "AI Translation Instructions"', async () => {
        render(<NewSourceUploader />);

        const targetUri = "file:///ws/files/AfterSetup.codex";

        await goToImportComplete({
            codexUri: targetUri,
            aiInstructionsCompleted: true,
        });

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /Start Translating/i }));
        });

        await waitFor(() => {
            expect(postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: "openImportedFile", codexUri: targetUri })
            );
        });

        expect(screen.queryByRole("heading", { name: /AI Translation Instructions/i })).toBeNull();
    });

    it("after a second import, Start Translating opens the latest imported file", async () => {
        render(<NewSourceUploader />);

        await goToImportComplete({
            codexUri: "file:///ws/files/FirstImport.codex",
            aiInstructionsCompleted: true,
        });

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /Import More Files/i }));
        });

        await waitFor(() => {
            expect(screen.getByText("Test Importer")).toBeInTheDocument();
        });

        postMessage.mockClear();

        await act(async () => {
            fireEvent.click(screen.getByText("Test Importer"));
        });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId("mock-import-complete"));
        });

        const secondUri = "file:///ws/files/SecondImport.codex";
        await act(async () => {
            dispatchHostMessage({
                command: "projectInventory",
                inventory: inventoryWithSources(2),
            });
            dispatchHostMessage({
                command: "importComplete",
                importedCodexUris: [secondUri],
                aiInstructionsCompleted: true,
            });
        });

        await waitFor(() => {
            const btn = screen.getByRole("button", { name: /Start Translating/i });
            expect(btn).not.toBeDisabled();
        });

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /Start Translating/i }));
        });

        await waitFor(() => {
            expect(postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: "openImportedFile", codexUri: secondUri })
            );
        });
    });
});
