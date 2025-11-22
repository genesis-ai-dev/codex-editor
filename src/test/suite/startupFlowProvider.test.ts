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
    let fetchStub: sinon.SinonStub;
    let postMessageStub: sinon.SinonStub;
    const postedMessages: any[] = [];

    setup(() => {
        context = createMockExtensionContext();
        provider = new StartupFlowProvider(context);
        mockWebviewPanel = createMockWebviewPanel();

        // Stub global fetch
        fetchStub = sinon.stub(global, "fetch");

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
        fetchStub.restore();
        postMessageStub.restore();
        sinon.restore();
        postedMessages.length = 0;
    });

    test("should handle password reset request successfully", async () => {
        const testEmail = "test@example.com";

        // Mock successful API response
        const mockResponse = {
            ok: true,
            status: 200,
            json: sinon.stub().resolves({}),
        };
        fetchStub.resolves(mockResponse);

        // Create message
        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
            resetEmail: testEmail,
        };

        // Call handleMessage (which routes to handleAuthenticationMessage)
        await (provider as any).handleMessage(message);

        // Verify fetch was called with correct parameters
        assert.ok(fetchStub.calledOnce, "Fetch should be called once");
        const fetchCall = fetchStub.getCall(0);
        assert.strictEqual(
            fetchCall.args[0],
            "https://api.frontierrnd.com/api/v1/auth/password-reset/request",
            "Should call correct endpoint"
        );

        const fetchOptions = fetchCall.args[1];
        assert.strictEqual(fetchOptions.method, "POST", "Should use POST method");
        assert.deepStrictEqual(
            fetchOptions.headers,
            { "Content-Type": "application/json" },
            "Should have correct headers"
        );

        const requestBody = JSON.parse(fetchOptions.body);
        assert.strictEqual(
            requestBody.email,
            testEmail,
            "Should send email in request body"
        );
    });

    test("should handle password reset error with string detail", async () => {
        const testEmail = "test@example.com";
        const errorMessage = "Email not found";

        // Mock error API response with string detail
        const mockResponse = {
            ok: false,
            status: 404,
            json: sinon.stub().resolves({ detail: errorMessage }),
        };
        fetchStub.resolves(mockResponse);

        // Clear any messages from state machine initialization
        postedMessages.length = 0;

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
            resetEmail: testEmail,
        };

        await (provider as any).handleMessage(message);

        // Filter out state.update messages to only count password reset messages
        const passwordResetMessages = postedMessages.filter((msg) => msg.command !== "state.update");

        // Verify error message was sent
        assert.strictEqual(passwordResetMessages.length, 1, "Should post one message");
        assert.strictEqual(
            passwordResetMessages[0].command,
            "passwordReset.error",
            "Should send error command"
        );
        assert.strictEqual(
            passwordResetMessages[0].error,
            errorMessage,
            "Should send correct error message"
        );
    });

    test("should handle password reset error with object detail (validation error)", async () => {
        const testEmail = "test@example.com";

        // Mock error API response with object detail (Pydantic validation error)
        const mockResponse = {
            ok: false,
            status: 422,
            json: sinon.stub().resolves({
                detail: {
                    type: "value_error",
                    loc: ["body", "email"],
                    msg: "Invalid email format",
                    input: testEmail,
                },
            }),
        };
        fetchStub.resolves(mockResponse);

        // Clear any messages from state machine initialization
        postedMessages.length = 0;

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
            resetEmail: testEmail,
        };

        await (provider as any).handleMessage(message);

        // Filter out state.update messages to only count password reset messages
        const passwordResetMessages = postedMessages.filter((msg) => msg.command !== "state.update");

        // Verify error message was extracted from object
        assert.strictEqual(passwordResetMessages.length, 1, "Should post one message");
        assert.strictEqual(
            passwordResetMessages[0].command,
            "passwordReset.error",
            "Should send error command"
        );
        assert.strictEqual(
            passwordResetMessages[0].error,
            "Invalid email format",
            "Should extract msg from error object"
        );
    });

    test("should handle password reset error with array of validation errors", async () => {
        const testEmail = "test@example.com";

        // Mock error API response with array of validation errors
        const mockResponse = {
            ok: false,
            status: 422,
            json: sinon.stub().resolves({
                detail: [
                    { type: "value_error", loc: ["body", "email"], msg: "Invalid email format", input: testEmail },
                    { type: "value_error", loc: ["body", "email"], msg: "Email is required", input: "" },
                ],
            }),
        };
        fetchStub.resolves(mockResponse);

        // Clear any messages from state machine initialization
        postedMessages.length = 0;

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
            resetEmail: testEmail,
        };

        await (provider as any).handleMessage(message);

        // Filter out state.update messages to only count password reset messages
        const passwordResetMessages = postedMessages.filter((msg) => msg.command !== "state.update");

        // Verify error messages were combined
        assert.strictEqual(passwordResetMessages.length, 1, "Should post one message");
        assert.strictEqual(
            passwordResetMessages[0].command,
            "passwordReset.error",
            "Should send error command"
        );
        assert.ok(
            passwordResetMessages[0].error.includes("Invalid email format"),
            "Should include first error message"
        );
        assert.ok(
            passwordResetMessages[0].error.includes("Email is required"),
            "Should include second error message"
        );
    });

    test("should handle password reset error with message field", async () => {
        const testEmail = "test@example.com";
        const errorMessage = "Server error occurred";

        // Mock error API response with message field instead of detail
        const mockResponse = {
            ok: false,
            status: 500,
            json: sinon.stub().resolves({ message: errorMessage }),
        };
        fetchStub.resolves(mockResponse);

        // Clear any messages from state machine initialization
        postedMessages.length = 0;

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
            resetEmail: testEmail,
        };

        await (provider as any).handleMessage(message);

        // Filter out state.update messages to only count password reset messages
        const passwordResetMessages = postedMessages.filter((msg) => msg.command !== "state.update");

        // Verify error message was extracted from message field
        assert.strictEqual(passwordResetMessages.length, 1, "Should post one message");
        assert.strictEqual(
            passwordResetMessages[0].command,
            "passwordReset.error",
            "Should send error command"
        );
        assert.strictEqual(
            passwordResetMessages[0].error,
            errorMessage,
            "Should extract message from response"
        );
    });

    test("should handle network errors gracefully", async () => {
        const testEmail = "test@example.com";

        // Mock network error
        fetchStub.rejects(new Error("Network error"));

        // Clear any messages from state machine initialization
        postedMessages.length = 0;

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
            resetEmail: testEmail,
        };

        await (provider as any).handleMessage(message);

        // Filter out state.update messages to only count password reset messages
        const passwordResetMessages = postedMessages.filter((msg) => msg.command !== "state.update");

        // Verify error message was sent
        assert.strictEqual(passwordResetMessages.length, 1, "Should post one message");
        assert.strictEqual(
            passwordResetMessages[0].command,
            "passwordReset.error",
            "Should send error command"
        );
        assert.strictEqual(
            passwordResetMessages[0].error,
            "Network error",
            "Should send network error message"
        );
    });

    test("should send success message when password reset succeeds", async () => {
        const testEmail = "test@example.com";

        // Mock successful API response
        const mockResponse = {
            ok: true,
            status: 200,
            json: sinon.stub().resolves({}),
        };
        fetchStub.resolves(mockResponse);

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
            resetEmail: testEmail,
        };

        await (provider as any).handleMessage(message);

        // Verify success message was sent
        assert.strictEqual(postedMessages.length, 1, "Should post one message");
        assert.strictEqual(
            postedMessages[0].command,
            "passwordReset.success",
            "Should send success command"
        );
    });

    test("should route auth.requestPasswordReset to handleAuthenticationMessage", async () => {
        const testEmail = "test@example.com";

        // Mock successful response
        const mockResponse = {
            ok: true,
            status: 200,
            json: sinon.stub().resolves({}),
        };
        fetchStub.resolves(mockResponse);

        // Spy on handleAuthenticationMessage
        const handleAuthMessageSpy = sinon.spy(provider as any, "handleAuthenticationMessage");

        const message: MessagesToStartupFlowProvider = {
            command: "auth.requestPasswordReset",
            resetEmail: testEmail,
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

