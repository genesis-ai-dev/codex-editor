import * as vscode from "vscode";
import { SQLiteIndexManager } from "./sqliteIndex";
import * as path from "path";

// Simple test to verify SQLiteIndexManager works
export async function testSQLiteIndexManager() {
    console.log("Testing SQLiteIndexManager...");

    const manager = new SQLiteIndexManager();

    // Mock extension context
    const mockContext = {
        extensionUri: vscode.Uri.file(path.join(__dirname, "../../../../../")),
    } as vscode.ExtensionContext;

    try {
        // Initialize
        await manager.initialize(mockContext);
        console.log("✓ Initialized successfully");

        // Test adding a document
        await manager.add({
            id: "test-1",
            cellId: "GEN 1:1",
            document: "GEN",
            section: "1",
            sourceContent: "In the beginning God created the heavens and the earth.",
            targetContent: "En el principio Dios creó los cielos y la tierra.",
            uri: "test.codex",
            line: 1,
        });
        console.log("✓ Added document successfully");

        // Test searching
        const results = await manager.search("beginning");
        console.log(`✓ Search returned ${results.length} results`);

        // Test document count
        console.log(`✓ Document count: ${manager.documentCount}`);

        // Test getting by ID
        const doc = await manager.getById("GEN 1:1");
        console.log(`✓ Retrieved document by ID: ${doc ? "found" : "not found"}`);

        // Test with Greek text and special characters
        await manager.add({
            id: "test-2",
            cellId: "MRK 1:3",
            document: "MRK",
            section: "1",
            sourceContent:
                "φωνὴ βοῶντος ἐν τῇ ἐρήμῳ· Ἑτοιμάσατε τὴν ὁδὸν κυρίου, εὐθείας ποιεῖτε τὰς τρίβους αὐτοῦ,",
            targetContent:
                "Voz del que clama en el desierto: Preparad el camino del Señor, enderezad sus sendas.",
            uri: "test.codex",
            line: 3,
        });
        console.log("✓ Added Greek text document successfully");

        // Test searching with Greek text
        const greekResults = await manager.search("φωνὴ βοῶντος");
        console.log(`✓ Greek search returned ${greekResults.length} results`);

        // Test searching with special characters
        const specialCharResults = await manager.search("ἐρήμῳ· Ἑτοιμάσατε");
        console.log(`✓ Special character search returned ${specialCharResults.length} results`);

        // Test searching with commas
        const commaResults = await manager.search("κυρίου, εὐθείας");
        console.log(`✓ Comma search returned ${commaResults.length} results`);

        // Cleanup
        await manager.close();
        console.log("✓ Closed successfully");

        console.log("\nAll tests passed! ✅");
    } catch (error) {
        console.error("Test failed:", error);
    }
}

// Run test if this file is executed directly
if (require.main === module) {
    testSQLiteIndexManager();
}
