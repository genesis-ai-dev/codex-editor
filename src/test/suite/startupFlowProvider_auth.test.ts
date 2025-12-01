import * as assert from "assert";
import * as vscode from "vscode";
import { StartupFlowProvider, StartupFlowEvents } from "../../providers/StartupFlow/StartupFlowProvider";
import { createMockExtensionContext, createMockWebviewPanel } from "../testUtils";
import sinon from "sinon";
import { MessagesToStartupFlowProvider } from "../../../types";
import * as webviewUtils from "../../utils/webviewUtils";

suite("StartupFlowProvider Auth Test Suite", () => {
    let context: vscode.ExtensionContext;
    let provider: StartupFlowProvider;
    let mockWebviewPanel: ReturnType<typeof createMockWebviewPanel>;
    let postMessageStub: sinon.SinonStub;
    const postedMessages: any[] = [];

    setup(() => {
        context = createMockExtensionContext();
        provider = new StartupFlowProvider(context);
        mockWebviewPanel = createMockWebviewPanel();

        // Stub safePostMessageToPanel
        postedMessages.length = 0;
        postMessageStub = sinon.stub(webviewUtils, "safePostMessageToPanel").callsFake((panel: any, message: any) => {
            postedMessages.push(message);
            return true;
        });

        // Mock frontierApi
        (provider as any).frontierApi = {
            getAuthStatus: () => ({ isAuthenticated: false }),
        };

        // Mock stateMachine
        (provider as any).stateMachine = {
            send: sinon.stub(),
        };

        // Set webview panel on provider
        (provider as any).webviewPanel = mockWebviewPanel.panel;
    });

    teardown(() => {
        postMessageStub.restore();
        sinon.restore();
        postedMessages.length = 0;
    });

    test("should handle auth.backToLogin command", async () => {
        const message: MessagesToStartupFlowProvider = {
            command: "auth.backToLogin",
        };

        await (provider as any).handleMessage(message);

        const sendStub = (provider as any).stateMachine.send as sinon.SinonStub;
        assert.ok(sendStub.calledOnce, "State machine send should be called once");
        assert.deepStrictEqual(
            sendStub.firstCall.args[0],
            { type: StartupFlowEvents.BACK_TO_LOGIN },
            "Should send BACK_TO_LOGIN event"
        );
    });

    test("should handle auth.status command", async () => {
        const message: MessagesToStartupFlowProvider = {
            command: "auth.status",
        };

        // specific mock for this test
        (provider as any).frontierApi.getAuthStatus = () => ({ isAuthenticated: true });

        await (provider as any).handleMessage(message);

        const sendStub = (provider as any).stateMachine.send as sinon.SinonStub;
        assert.ok(sendStub.calledOnce, "State machine send should be called");
        
        const callArgs = sendStub.firstCall.args[0];
        assert.strictEqual(callArgs.type, StartupFlowEvents.UPDATE_AUTH_STATE);
        assert.strictEqual(callArgs.data.isAuthenticated, true);
    });
});

