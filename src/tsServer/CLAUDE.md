# Language Server (tsServer)

LSP-based language features for .codex files.

## Architecture

```
server.ts                    # Language server entry
registerLanguageServer.ts    # Client initialization
registerClientCommands.ts    # Client-side commands
registerClientOnRequests.ts  # Request handlers
connection.ts               # Server connection setup
spellCheck.ts               # Spell checking
types.ts                    # LSP types
```

## Server ↔ Client Communication

```typescript
// Server (server.ts)
connection.onCompletion((params) => {
    return [{ label: "suggestion", kind: CompletionItemKind.Text }];
});

// Client registration (registerLanguageServer.ts)
const client = new LanguageClient("codex-ls", "Codex Language Server", serverOptions, clientOptions);
client.start();
```

## Adding Language Features

### Completions
```typescript
connection.onCompletion((params): CompletionItem[] => {
    // Return completion items
});
```

### Diagnostics
```typescript
connection.onDidChangeTextDocument((params) => {
    const diagnostics = validate(params.contentChanges);
    connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics });
});
```

### Hover
```typescript
connection.onHover((params): Hover => {
    return { contents: "Info about symbol" };
});
```

## Client Commands

Register in `registerClientCommands.ts`:
```typescript
vscode.commands.registerCommand("codex.yourCommand", async () => {
    const result = await client.sendRequest("custom/yourRequest", params);
});
```

## Gotchas

- Server runs in separate process
- Use `connection.console.log()` for server-side logging
- Client must wait for server ready before requests
- Spell check currently disabled (see TODO in codebase)
