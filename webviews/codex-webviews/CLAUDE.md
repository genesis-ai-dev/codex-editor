# Webviews (React UI)

React-based UI components built with Vite. Output goes to `dist/` and is loaded by extension providers.

## Commands

```bash
pnpm install           # Install deps
pnpm run build:all     # Production build
pnpm run smart-watch   # Dev watch mode
pnpm run test          # Vitest tests
pnpm run test:watch    # Watch mode
pnpm run test:ui       # Interactive test UI
```

## Structure

```
src/
├── CodexCellEditor/   # Main cell editing view
├── components/        # Shared components
├── shared/           # Utilities, hooks
├── [FeatureName]/    # Feature views (MainMenu, Navigation, etc.)
└── tailwind.css      # Global styles
```

## Adding a New View

### 1. Create Feature Directory
```
src/YourFeature/
├── YourFeature.tsx    # Main component
├── index.tsx          # Entry point with vscode API setup
└── components/        # Feature-specific components
```

### 2. Entry Point Pattern
```tsx
// index.tsx
import { createRoot } from "react-dom/client";
import YourFeature from "./YourFeature";

const vscode = acquireVsCodeApi();
createRoot(document.getElementById("root")!).render(<YourFeature vscode={vscode} />);
```

### 3. Vite Config
Add entry to `vite.config.ts`:
```typescript
build: {
    rollupOptions: {
        input: {
            yourFeature: "src/YourFeature/index.tsx"
        }
    }
}
```

### 4. Message Communication
```tsx
// Receive from extension
useEffect(() => {
    const handler = (e: MessageEvent) => {
        if (e.data.command === "update") setData(e.data.data);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
}, []);

// Send to extension
vscode.postMessage({ command: "save", data: formData });
```

## Styling

- **Tailwind CSS** - Primary styling
- **VS Code Toolkit** - `@vscode/webview-ui-toolkit` for native look
- **RTL Support** - Use `textDirection` config, dir attribute

## Component Patterns

```tsx
// Use VS Code design tokens
<div className="text-vscode-foreground bg-vscode-editor-background">

// Toolkit components
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
<VSCodeButton onClick={handleClick}>Save</VSCodeButton>
```

## Testing

```tsx
// src/YourFeature/__tests__/YourFeature.test.tsx
import { render, screen } from "@testing-library/react";
import YourFeature from "../YourFeature";

test("renders correctly", () => {
    render(<YourFeature vscode={mockVscode} />);
    expect(screen.getByText("Expected Text")).toBeInTheDocument();
});
```

## Gotchas

- **acquireVsCodeApi()** can only be called once - pass as prop
- **State persistence** - use `vscode.setState()` / `vscode.getState()`
- **Asset paths** - use webview.asWebviewUri() for local resources
- **No direct FS access** - all file ops via message to extension
- **CSP restrictions** - inline styles may be blocked, use classes
