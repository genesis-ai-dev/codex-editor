# Providers Directory

Webview providers and custom editors. Central hub: `registerProviders.ts`

## Adding a New Provider

### 1. Sidebar View Provider
```typescript
// YourProvider.ts
export class YourProvider implements vscode.WebviewViewProvider {
    resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getWebviewContent(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(this.handleMessage);
    }
}

// registerProviders.ts - add registration
context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("your-view-id", new YourProvider())
);
```

### 2. Custom Editor Provider
```typescript
export class YourEditorProvider implements vscode.CustomEditorProvider<YourDocument> {
    openCustomDocument(uri: vscode.Uri) { /* ... */ }
    resolveCustomEditor(document, webviewPanel) { /* ... */ }
}
```

### 3. Package.json Required
```json
{
  "contributes": {
    "views": { "your-container": [{ "type": "webview", "id": "your-view-id" }] },
    "viewsContainers": { "activitybar": [{ "id": "your-container" }] },
    "customEditors": [{ "viewType": "your.editor", "selector": [{ "filenamePattern": "*.ext" }] }]
  }
}
```

## Key Providers

| Provider | Type | Purpose |
|----------|------|---------|
| `codexCellEditorProvider` | CustomEditor | Main .codex file editor |
| `navigationWebview` | WebviewView | Project navigation sidebar |
| `mainMenu` | WebviewView | Project settings panel |
| `commentsWebview` | WebviewView | Comments sidebar |
| `parallelPassagesWebview` | WebviewView | Search passages |
| `StartupFlow` | CustomEditor | Project setup wizard |
| `SplashScreen` | WebviewPanel | Loading screen |

## Message Handling Pattern

```typescript
// Provider side
webview.onDidReceiveMessage((message) => {
    switch (message.command) {
        case "ready": this.webviewReadyState.set(id, true); break;
        case "save": this.saveDocument(message.data); break;
    }
});

// Send with ready check
if (this.webviewReadyState.get(id)) {
    webview.postMessage({ command: "update", data });
} else {
    this.pendingWebviewUpdates.get(id)?.push(() => webview.postMessage(...));
}
```

## CSP Template
Always include proper CSP. See `webviewTemplate.ts` for base template.

## Gotchas

- Provider instances are singletons - use `getInstance()` pattern
- Webviews may not be ready immediately - track ready state
- `retainContextWhenHidden: true` keeps state but uses memory
- Disposables must be registered with context.subscriptions
