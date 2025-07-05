# Smart Watch for Webviews

The smart watch feature automatically detects which webviews have changed and builds only those views, significantly improving development speed.

## Features

- **Intelligent Detection**: Automatically determines which views are affected by file changes
- **Parallel Building**: Builds multiple views simultaneously for better performance
- **Debounced Builds**: Prevents excessive rebuilding during rapid file changes
- **Detailed Logging**: Shows exactly what's being built and why
- **Graceful Shutdown**: Properly handles interruption signals

## Usage

### From the root directory:
```bash
npm run smart-watch
```

### From the webviews directory:
```bash
cd webviews/codex-webviews
pnpm run smart-watch
```

## How It Works

### File Change Detection

The smart watch monitors these file patterns:
- `src/**/*.{ts,tsx,js,jsx,css,json}`
- `package.json`
- `vite.config.ts`
- `tailwind.config.js`
- `postcss.config.js`
- `tsconfig.json`

### Build Logic

1. **View-Specific Changes**: If you edit a file in `src/CodexCellEditor/`, only the CodexCellEditor view will be rebuilt
2. **Shared File Changes**: If you edit files in `src/components/`, `src/shared/`, `src/lib/`, etc., all views will be rebuilt
3. **Config File Changes**: If you edit configuration files, all views will be rebuilt

### Monitored Views

- StartupFlow
- ParallelView
- CodexCellEditor
- CommentsView
- NavigationView
- EditableReactTable
- SourceUpload
- MainMenu
- SplashScreen
- CellLabelImporterView
- NewSourceUploader

## Example Output

```
🔍 Starting smart watch for webviews...
📊 Monitoring 11 views: StartupFlow, ParallelView, CodexCellEditor, CommentsView, NavigationView, EditableReactTable, SourceUpload, MainMenu, SplashScreen, CellLabelImporterView, NewSourceUploader
✅ Smart watch is ready and monitoring for changes
💡 Tip: Edit files in src/ to see automatic rebuilding in action

📁 Analyzing change: src/CodexCellEditor/CodexCellEditor.tsx
🎯 Direct view match: CodexCellEditor
🚀 Starting build for 1 view(s): CodexCellEditor
🔨 Building CodexCellEditor...
✅ Build completed for CodexCellEditor (2341ms)
🎉 All builds completed
```

## Performance Benefits

- **Faster Development**: Only rebuilds what's needed instead of all 11 views
- **Parallel Processing**: Multiple views build simultaneously
- **Debounced Updates**: Prevents rebuild storms during rapid file changes
- **Smart Detection**: Accurately determines scope of changes

## Comparison with Existing Watch Commands

### Before (Traditional Watch):
- `watch:all` - Rebuilds all 11 views on any change (slow)
- `watch:CodexCellEditor` - Only watches CodexCellEditor but misses shared dependencies

### After (Smart Watch):
- Rebuilds only affected views
- Handles shared dependencies correctly
- Builds multiple views in parallel
- Provides detailed feedback

## Troubleshooting

### If builds fail:
- Check the console output for specific error messages
- Ensure all dependencies are installed: `pnpm install`
- Verify that individual build commands work: `pnpm run build:CodexCellEditor`

### If changes aren't detected:
- Ensure files are saved properly
- Check that file patterns match the monitored extensions
- Restart the smart watch process

### To stop the smart watch:
Press `Ctrl+C` to gracefully shut down the process. 