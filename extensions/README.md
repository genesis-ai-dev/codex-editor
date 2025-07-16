# Extension Dependencies

This directory is used to store VSIX files for VS Code extensions that need to be installed before running WebdriverIO tests.

## Adding Extension Dependencies

### Method 1: VSIX Files (Recommended)

1. Obtain the `project-accelerate.shared-state-store.vsix` file from your team or organization
2. Place it in this directory with the exact name: `project-accelerate.shared-state-store.vsix`
3. The test setup will automatically install it before running tests

### Method 2: Manual Installation

If you have access to the extension, you can install it manually:

```bash
# Install from VSIX file
code --install-extension path/to/project-accelerate.shared-state-store.vsix

# Or from marketplace (if available)
code --install-extension project-accelerate.shared-state-store
```

### Method 3: Environment Setup Script

Create a setup script to install all required extensions:

```bash
#!/bin/bash
# setup-extensions.sh

echo "Installing required VS Code extensions..."

# Install dependency extension
if [ -f "./extensions/project-accelerate.shared-state-store.vsix" ]; then
    code --install-extension ./extensions/project-accelerate.shared-state-store.vsix
    echo "✅ Installed shared-state-store extension"
else
    echo "⚠️  shared-state-store.vsix not found"
fi

echo "Extension setup complete!"
```

## Troubleshooting

### Extension Not Found

If you get the error about the missing extension:

1. Check that the VSIX file is in this directory
2. Verify the filename matches exactly: `project-accelerate.shared-state-store.vsix`
3. Try manual installation using VS Code CLI
4. Contact your team lead for the extension file

### Alternative Solutions

If the extension isn't available, you can:

1. **Mock the extension**: Create a minimal stub extension with the same ID
2. **Skip dependency check**: Modify your extension to handle missing dependencies gracefully
3. **Use workspace configuration**: Set up a workspace with the required extensions pre-installed

## Files in this directory

- `README.md` - This file
- `project-accelerate.shared-state-store.vsix` - (Place the required extension here)
- Any other required extension VSIX files
