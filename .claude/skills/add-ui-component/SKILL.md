---
name: add-ui-component
description: Add UI components to Codex Editor. Use when adding buttons, sidebar views, panels, or React components to the VS Code extension.
---

# Add UI Component

## Webview Sidebar Panel

1. **package.json** - Register view container and view:
```json
"viewsContainers": {
    "activitybar": [{ "id": "your-view", "title": "Your View", "icon": "$(icon-name)" }]
},
"views": {
    "your-view": [{ "type": "webview", "id": "your-view-id", "name": "Your View" }]
}
```

2. **src/providers/YourProvider.ts** - Create provider:
```typescript
export class YourProvider implements vscode.WebviewViewProvider {
    resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml(webviewView.webview);
    }
}
```

3. **src/providers/registerProviders.ts** - Register:
```typescript
context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("your-view-id", new YourProvider(context))
);
```

4. **webviews/codex-webviews/src/YourView/** - Create React component

5. **webviews/codex-webviews/vite.config.ts** - Add build entry

## React Component in Existing View

1. Create component in `webviews/codex-webviews/src/components/`
2. Import and use in parent view
3. Style with Tailwind or VS Code toolkit

## Button in Editor Title

```json
"menus": {
    "editor/title": [{
        "command": "your.command",
        "group": "navigation",
        "when": "resourceExtname == .codex"
    }]
}
```

## Gotchas

- **Always register in package.json** - Views, commands, menus
- **CSP** - Remote resources need explicit allow in webview HTML
- **Icons** - Use `$(codicon-name)` format, see [Codicons](https://microsoft.github.io/vscode-codicons/)
- **Webview ready state** - Track before sending messages
- **Build webviews** - Run `npm run build:webviews` after React changes

## Post-Session Review

Before ending session, if this skill was used:
1. What steps failed or needed extra lookup?
2. What error messages were encountered?
3. Update this SKILL.md to prevent future issues
