import * as assert from "assert";
import * as vscode from "vscode";
import { SourceAnalyzer } from "../../utils/sourceAnalyzer";
import { SourceFileValidator } from "../../validation/sourceFileValidator";
import { SourceImportTransaction } from "../../transactions/SourceImportTransaction";
import { createTestFile, cleanupTestFile } from "../testUtils";

suite("Source Import Tests", () => {
    let testFileUri: vscode.Uri;
    let analyzer: SourceAnalyzer;

    suiteSetup(() => {
        analyzer = new SourceAnalyzer(new SourceFileValidator());
    });

    setup(async () => {
        // Create a test USFM file
        const usfmContent = `\\id GEN
\\c 1
\\v 1 In the beginning...
\\v 2 And the earth...`;
        testFileUri = await createTestFile("test.usfm", usfmContent);
    });

    teardown(async () => {
        await cleanupTestFile(testFileUri);
    });

    test("should generate accurate preview", async () => {
        const preview = await analyzer.generatePreview(testFileUri);

        assert.strictEqual(preview.fileName, "test.usfm");
        assert.strictEqual(preview.fileType, "usfm");
        assert.strictEqual(preview.expectedBooks.length, 1);

        const book = preview.expectedBooks[0];
        assert.strictEqual(book.name, "GEN");
        assert.strictEqual(book.versesCount, 2);
        assert.strictEqual(book.chaptersCount, 1);
    });

    test("should validate file content", async () => {
        const preview = await analyzer.generatePreview(testFileUri);

        assert.strictEqual(preview.validationResults.length, 1);
        assert.strictEqual(preview.validationResults[0].isValid, true);
    });

    test("should prepare transaction with preview", async () => {
        const transaction = new SourceImportTransaction(testFileUri);
        const preview = await transaction.prepare();

        assert.ok(preview);
        assert.strictEqual(preview.fileName, "test.usfm");
        assert.strictEqual(preview.expectedBooks.length, 1);
    });

    test("should handle transaction cancellation", async () => {
        const transaction = new SourceImportTransaction(testFileUri);
        await transaction.prepare();

        const tokenSource = new vscode.CancellationTokenSource();
        const progressDummy = {
            report: () => {},
        };

        // Cancel after small delay
        setTimeout(() => tokenSource.cancel(), 10);

        await assert.rejects(transaction.execute(progressDummy, tokenSource.token), /Cancelled/);
    });
});
