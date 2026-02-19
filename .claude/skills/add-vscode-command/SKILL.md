---
name: add-vscode-command
description: Add VS Code commands to the extension. Use when creating new command palette entries, keybindings, or menu actions.
---

# Add VS Code Command

## Steps

### 1. package.json - Declare command
```json
"contributes": {
    "commands": [{
        "command": "codex-editor.yourCommand",
        "title": "Your Command Title",
        "category": "Codex Editor",
        "icon": "$(icon-name)"
    }]
}
```

### 2. Register handler

**Option A** - In `src/activationHelpers/contextAware/commands.ts`:
```typescript
export function registerCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor.yourCommand", async () => {
            // Implementation
        })
    );
}
```

**Option B** - Dedicated file for complex commands:
```typescript
// src/commands/yourCommand.ts
export function registerYourCommand(context: vscode.ExtensionContext) {
    return vscode.commands.registerCommand("codex-editor.yourCommand", handler);
}
```

Import and register in `extension.ts` or `commands.ts`.

### 3. Optional: Add to menu
```json
"menus": {
    "commandPalette": [{
        "command": "codex-editor.yourCommand",
        "when": "workspaceFolderCount > 0"
    }],
    "editor/title": [{
        "command": "codex-editor.yourCommand",
        "group": "navigation"
    }],
    "editor/context": [{
        "command": "codex-editor.yourCommand",
        "group": "codex"
    }]
}
```

### 4. Optional: Keybinding
```json
"keybindings": [{
    "command": "codex-editor.yourCommand",
    "key": "ctrl+shift+y",
    "when": "editorTextFocus"
}]
```

## When Clauses

Common contexts:
- `workspaceFolderCount > 0` - Workspace open
- `editorTextFocus` - Editor focused
- `resourceExtname == .codex` - .codex file active
- `view == your-view-id` - Specific view focused

## Gotchas

- **Namespace** - Use `codex-editor.` or `codex-editor-extension.` prefix
- **Disposables** - Always push to `context.subscriptions`
- **When clause** - Control visibility in command palette/menus
- **Category** - Groups commands in palette, use "Codex Editor"
- **Both required** - package.json declaration AND code registration

## Post-Session Review

Before ending session, if this skill was used:
1. What steps failed or needed extra lookup?
2. What error messages were encountered?
3. Update this SKILL.md to prevent future issues
