import * as assert from "assert";
import * as vscode from "vscode";
import { StartupFlowProvider } from "../../providers/StartupFlow/StartupFlowProvider";
import { createMockExtensionContext, createMockWebviewPanel } from "../testUtils";
import sinon from "sinon";
import { MessagesToStartupFlowProvider } from "../../../types";
import * as webviewUtils from "../../utils/webviewUtils";

suite("StartupFlowProvider Password Reset Test Suite", () => {
    let context: vscode.ExtensionContext;
    let provider: StartupFlowProvider;
    let mockWebviewPanel: ReturnType<typeof createMockWebviewPanel>;
    let openExternalStub: sinon.SinonStub;
    let postMessageStub: sinon.SinonStub;
    const postedMessages: any[] = [];

    setup(() => {
        context = createMockExtensionContext();
        provider = new StartupFlowProvider(context);
        mockWebviewPanel = createMockWebviewPanel();

        // Stub vscode.env.openExternal
        openExternalStub = sinon.stub(vscode.env, "openExternal");

        // Stub safePostMessageToPanel
        postedMessages.length = 0; // Clear array
        postMessageStub = sinon.stub(webviewUtils, "safePostMessageToPanel").callsFake((panel: any, message: any) => {
            postedMessages.push(message);
            return true;
        });

        // Mock frontierApi to avoid stateMachine.send() call in handleAuthenticationMessage
        // Password reset doesn't actually use frontierApi, but the handler checks for it
        (provider as any).frontierApi = {
            getAuthStatus: () => ({ isAuthenticated: false }),
        };

        // Mock stateMachine to avoid errors if it's accessed
        (provider as any).stateMachine = {
            send: sinon.stub(),
        };

        // Set webview panel on provider
        (provider as any).webviewPanel = mockWebviewPanel.panel;
    });

    teardown(() => {
        openExternalStub.restore();
        postMessageStub.restore();
        sinon.restore();
        postedMessages.length = 0;
    });

    test("should open password reset page and send success message", async () => {
        openExternalStub.resolves(true);

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
        };

        await (provider as any).handleMessage(message);

        assert.ok(openExternalStub.calledOnce, "openExternal should be called once");
        const openExternalCall = openExternalStub.getCall(0);
        assert.strictEqual(
            openExternalCall.args[0].toString(),
            "https://api.frontierrnd.com/login",
            "Should open correct reset URL"
        );

        assert.strictEqual(postedMessages.length, 1, "Should post one message");
        assert.strictEqual(
            postedMessages[0].command,
            "passwordReset.success",
            "Should send success command"
        );
    });

    test("should send error message when browser does not open", async () => {
        openExternalStub.resolves(false);

        postedMessages.length = 0;

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
        };

        await (provider as any).handleMessage(message);

        const passwordResetMessages = postedMessages.filter((msg) => msg.command !== "state.update");
        assert.strictEqual(passwordResetMessages.length, 1, "Should post one message");
        assert.strictEqual(
            passwordResetMessages[0].command,
            "passwordReset.error",
            "Should send error command"
        );
        assert.ok(
            passwordResetMessages[0].error.includes("https://api.frontierrnd.com/login"),
            "Should include reset URL in error message"
        );
    });

    test("should handle openExternal errors gracefully", async () => {
        openExternalStub.rejects(new Error("Open failed"));

        postedMessages.length = 0;

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
        };

        await (provider as any).handleMessage(message);

        const passwordResetMessages = postedMessages.filter((msg) => msg.command !== "state.update");
        assert.strictEqual(passwordResetMessages.length, 1, "Should post one message");
        assert.strictEqual(
            passwordResetMessages[0].command,
            "passwordReset.error",
            "Should send error command"
        );
        assert.strictEqual(
            passwordResetMessages[0].error,
            "Open failed",
            "Should send openExternal error message"
        );
    });

    test("should route auth.requestPasswordReset to handleAuthenticationMessage", async () => {
        openExternalStub.resolves(true);

        // Spy on handleAuthenticationMessage
        const handleAuthMessageSpy = sinon.spy(provider as any, "handleAuthenticationMessage");

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
        };

        await (provider as any).handleMessage(message);

        // Verify message was routed to handleAuthenticationMessage
        assert.ok(handleAuthMessageSpy.calledOnce, "Should route to handleAuthenticationMessage");
        assert.deepStrictEqual(
            handleAuthMessageSpy.getCall(0).args[1],
            message,
            "Should pass message correctly"
        );
    });
});

