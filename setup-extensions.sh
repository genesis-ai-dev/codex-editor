#!/bin/bash

# VS Code Extension Setup Script for WebdriverIO Tests
# This script installs required extensions for testing

echo "🔧 Setting up VS Code extensions for testing..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if VS Code CLI is available
if ! command -v code &> /dev/null; then
    echo -e "${RED}❌ VS Code CLI not found. Please install VS Code and ensure 'code' command is available.${NC}"
    echo "   You can add it via: CMD+Shift+P > 'Shell Command: Install code command in PATH'"
    exit 1
fi

echo -e "${GREEN}✅ VS Code CLI found${NC}"

# Function to install extension from VSIX
install_from_vsix() {
    local vsix_path="$1"
    local extension_name="$2"
    
    if [ -f "$vsix_path" ]; then
        echo -e "${YELLOW}📦 Installing $extension_name from VSIX...${NC}"
        if code --install-extension "$vsix_path" --force; then
            echo -e "${GREEN}✅ Successfully installed $extension_name${NC}"
            return 0
        else
            echo -e "${RED}❌ Failed to install $extension_name${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}⚠️  VSIX file not found: $vsix_path${NC}"
        return 1
    fi
}

# Install required extensions
echo "📋 Installing required extensions..."

# Install the shared-state-store extension
SHARED_STATE_VSIX="./extensions/project-accelerate.shared-state-store.vsix"
if ! install_from_vsix "$SHARED_STATE_VSIX" "shared-state-store"; then
    echo -e "${YELLOW}💡 To install the shared-state-store extension:${NC}"
    echo "   1. Obtain the project-accelerate.shared-state-store.vsix file"
    echo "   2. Place it at: $SHARED_STATE_VSIX"
    echo "   3. Run this script again"
    echo ""
    echo -e "${YELLOW}🔍 Alternative: Try installing from marketplace (if available):${NC}"
    echo "   code --install-extension project-accelerate.shared-state-store"
fi

# Check for other VSIX files in extensions directory
echo ""
echo "🔍 Checking for additional extensions..."
if [ -d "./extensions" ]; then
    for vsix_file in ./extensions/*.vsix; do
        if [ -f "$vsix_file" ] && [ "$vsix_file" != "$SHARED_STATE_VSIX" ]; then
            extension_name=$(basename "$vsix_file" .vsix)
            install_from_vsix "$vsix_file" "$extension_name"
        fi
    done
fi

echo ""
echo -e "${GREEN}🎉 Extension setup complete!${NC}"
echo ""
echo "📝 Next steps:"
echo "   1. Run your tests: npm run wdio"
echo "   2. If tests fail due to missing extensions, check the extensions/ directory"
echo "   3. Consult the extensions/README.md for more help"

# List installed extensions for verification
echo ""
echo "📋 Currently installed extensions (filtered for project-accelerate):"
code --list-extensions | grep -i "project-accelerate" || echo "   No project-accelerate extensions found" 