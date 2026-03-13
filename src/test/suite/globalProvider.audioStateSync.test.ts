import * as assert from "assert";
import * as vscode from "vscode";
import { GlobalProvider } from "../../globalProvider";
import { GlobalMessage, GlobalContentType } from "../../../types";
import sinon from "sinon";

suite("GlobalProvider - Audio State Synchronization", () => {
    let globalProvider: GlobalProvider;
    let mockProvider1: any;
    let mockProvider2: any;

    setup(() => {
        // Reset singleton instance
        (GlobalProvider as any).instance = undefined;
        globalProvider = GlobalProvider.getInstance();

        // Create mock providers
        mockProvider1 = {
            postMessage: sinon.stub(),
            receiveMessage: sinon.stub(),
        };

        mockProvider2 = {
            postMessage: sinon.stub(),
            receiveMessage: sinon.stub(),
        };

        // Register mock providers
        globalProvider.registerProvider("provider1", mockProvider1 as any);
        globalProvider.registerProvider("provider2", mockProvider2 as any);
    });

    teardown(() => {
        sinon.restore();
    });

    test("should forward full GlobalMessage object to all webviews when destination is 'webview'", () => {
        const message: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        globalProvider.handleMessage(message);

        // Verify both providers received the full message object
        assert.ok(mockProvider1.postMessage.calledOnce, "Provider1 should receive message");
        assert.ok(mockProvider2.postMessage.calledOnce, "Provider2 should receive message");

        const provider1Call = mockProvider1.postMessage.getCall(0);
        const provider2Call = mockProvider2.postMessage.getCall(0);

        // Verify the full message structure is preserved
        assert.deepStrictEqual(
            provider1Call.args[0],
            message,
            "Provider1 should receive full GlobalMessage object"
        );
        assert.deepStrictEqual(
            provider2Call.args[0],
            message,
            "Provider2 should receive full GlobalMessage object"
        );

        // Verify all properties are present
        assert.strictEqual(provider1Call.args[0].command, "audioStateChanged");
        assert.strictEqual(provider1Call.args[0].destination, "webview");
        assert.ok(provider1Call.args[0].content);
        assert.strictEqual(provider1Call.args[0].content.type, "audioPlaying");
        assert.strictEqual(provider1Call.args[0].content.webviewType, "target");
        assert.strictEqual(provider1Call.args[0].content.isPlaying, true);
    });

    test("should preserve destination property in forwarded message", () => {
        const message: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "source",
                isPlaying: false,
            },
        };

        globalProvider.handleMessage(message);

        const provider1Call = mockProvider1.postMessage.getCall(0);
        assert.strictEqual(
            provider1Call.args[0].destination,
            "webview",
            "Destination should be preserved in forwarded message"
        );
    });

    test("should preserve command property in forwarded message", () => {
        const message: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        globalProvider.handleMessage(message);

        const provider1Call = mockProvider1.postMessage.getCall(0);
        assert.strictEqual(
            provider1Call.args[0].command,
            "audioStateChanged",
            "Command should be preserved in forwarded message"
        );
    });

    test("should preserve content property with audioPlaying type in forwarded message", () => {
        const message: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "source",
                isPlaying: true,
            },
        };

        globalProvider.handleMessage(message);

        const provider1Call = mockProvider1.postMessage.getCall(0);
        const content = provider1Call.args[0].content;

        assert.ok(content, "Content should be present");
        assert.strictEqual(content.type, "audioPlaying");
        assert.strictEqual(content.webviewType, "source");
        assert.strictEqual(content.isPlaying, true);
    });

    test("should forward messages to all registered providers", () => {
        const message: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        globalProvider.handleMessage(message);

        assert.strictEqual(
            mockProvider1.postMessage.callCount,
            1,
            "Provider1 should receive exactly one message"
        );
        assert.strictEqual(
            mockProvider2.postMessage.callCount,
            1,
            "Provider2 should receive exactly one message"
        );
    });

    test("should handle messages with different audioPlaying states", () => {
        const playingMessage: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        const stoppedMessage: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: false,
            },
        };

        globalProvider.handleMessage(playingMessage);
        globalProvider.handleMessage(stoppedMessage);

        assert.strictEqual(mockProvider1.postMessage.callCount, 2);
        assert.strictEqual(mockProvider2.postMessage.callCount, 2);

        // Verify first message has isPlaying: true
        const firstCall = mockProvider1.postMessage.getCall(0);
        assert.strictEqual(firstCall.args[0].content.isPlaying, true);

        // Verify second message has isPlaying: false
        const secondCall = mockProvider1.postMessage.getCall(1);
        assert.strictEqual(secondCall.args[0].content.isPlaying, false);
    });

    test("should handle messages with different webviewType values", () => {
        const sourceMessage: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "source",
                isPlaying: true,
            },
        };

        const targetMessage: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        globalProvider.handleMessage(sourceMessage);
        globalProvider.handleMessage(targetMessage);

        assert.strictEqual(mockProvider1.postMessage.callCount, 2);

        const firstCall = mockProvider1.postMessage.getCall(0);
        assert.strictEqual(firstCall.args[0].content.webviewType, "source");

        const secondCall = mockProvider1.postMessage.getCall(1);
        assert.strictEqual(secondCall.args[0].content.webviewType, "target");
    });

    test("should not forward messages when destination is 'provider'", () => {
        const message: GlobalMessage = {
            command: "someCommand",
            destination: "provider",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        globalProvider.handleMessage(message);

        // postMessage should not be called for provider destination
        assert.strictEqual(mockProvider1.postMessage.callCount, 0);
        assert.strictEqual(mockProvider2.postMessage.callCount, 0);

        // receiveMessage should be called instead
        assert.ok(mockProvider1.receiveMessage.calledOnce);
        assert.ok(mockProvider2.receiveMessage.calledOnce);
    });

    test("should handle messages without destination property gracefully", () => {
        const messageWithoutDestination = {
            command: "someCommand",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        // Should not throw an error
        assert.doesNotThrow(() => {
            globalProvider.handleMessage(messageWithoutDestination);
        });

        // Should not forward to webviews
        assert.strictEqual(mockProvider1.postMessage.callCount, 0);
    });

    test("should forward messages to newly registered providers", () => {
        const mockProvider3 = {
            postMessage: sinon.stub(),
            receiveMessage: sinon.stub(),
        };

        globalProvider.registerProvider("provider3", mockProvider3 as any);

        const message: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        globalProvider.handleMessage(message);

        // All three providers should receive the message
        assert.strictEqual(mockProvider1.postMessage.callCount, 1);
        assert.strictEqual(mockProvider2.postMessage.callCount, 1);
        assert.strictEqual(mockProvider3.postMessage.callCount, 1);
    });

    test("should not forward messages to unregistered providers", () => {
        const mockProvider3 = {
            postMessage: sinon.stub(),
            receiveMessage: sinon.stub(),
        };

        const disposable = globalProvider.registerProvider("provider3", mockProvider3 as any);
        disposable.dispose(); // Unregister

        const message: GlobalMessage = {
            command: "audioStateChanged",
            destination: "webview",
            content: {
                type: "audioPlaying",
                webviewType: "target",
                isPlaying: true,
            },
        };

        globalProvider.handleMessage(message);

        // Only provider1 and provider2 should receive the message
        assert.strictEqual(mockProvider1.postMessage.callCount, 1);
        assert.strictEqual(mockProvider2.postMessage.callCount, 1);
        assert.strictEqual(mockProvider3.postMessage.callCount, 0);
    });
});
