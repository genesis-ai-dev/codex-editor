#!/bin/bash

# Check FTS5 Setup Script
# This script verifies that the required files for FTS5 support are in place

echo "🔍 Checking FTS5 Setup for Codex Editor..."
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if out directory exists
if [ ! -d "out" ]; then
    print_error "out/ directory not found. Please run 'npm run compile' first."
    exit 1
else
    print_success "out/ directory exists"
fi

# Check for sql-wasm.js
if [ -f "out/sql-wasm.js" ]; then
    print_success "sql-wasm.js found"
    
    # Check file size (should be larger with FTS5)
    size=$(stat -f%z "out/sql-wasm.js" 2>/dev/null || stat -c%s "out/sql-wasm.js" 2>/dev/null)
    if [ "$size" -gt 1000000 ]; then
        print_success "sql-wasm.js size looks good (${size} bytes)"
    else
        print_warning "sql-wasm.js seems small (${size} bytes) - might not include FTS5"
    fi
else
    print_error "sql-wasm.js not found in out/ directory"
fi

# Check for sql-wasm.wasm
if [ -f "out/sql-wasm.wasm" ]; then
    print_success "sql-wasm.wasm found"
    
    # Check file size (should be larger with FTS5)
    size=$(stat -f%z "out/sql-wasm.wasm" 2>/dev/null || stat -c%s "out/sql-wasm.wasm" 2>/dev/null)
    if [ "$size" -gt 1500000 ]; then
        print_success "sql-wasm.wasm size looks good (${size} bytes)"
        
        # Check if FTS5 is compiled in (if strings command is available)
        if command -v strings &> /dev/null; then
            if strings "out/sql-wasm.wasm" | grep -q "fts5"; then
                print_success "FTS5 support detected in WASM file"
            else
                print_warning "FTS5 support not detected in WASM file"
                echo "  This might be a false negative, or FTS5 might not be compiled in."
            fi
        else
            print_warning "strings command not available - cannot verify FTS5 in WASM"
        fi
    else
        print_warning "sql-wasm.wasm seems small (${size} bytes) - might not include FTS5"
    fi
else
    print_error "sql-wasm.wasm not found in out/ directory"
fi

# Check webpack config
if [ -f "webpack.config.js" ]; then
    if grep -q "sql-wasm.wasm" webpack.config.js; then
        print_success "webpack.config.js includes WASM file copy"
    else
        print_warning "webpack.config.js might not be configured to copy WASM file"
    fi
else
    print_warning "webpack.config.js not found"
fi

# Check package.json for sql.js dependency
if [ -f "package.json" ]; then
    if grep -q "sql.js" package.json; then
        print_success "sql.js dependency found in package.json"
    else
        print_warning "sql.js dependency not found in package.json"
    fi
else
    print_warning "package.json not found"
fi

echo ""
echo "📋 Summary:"
echo "==========="

# Count issues
issues=0

if [ ! -f "out/sql-wasm.js" ]; then
    issues=$((issues + 1))
fi

if [ ! -f "out/sql-wasm.wasm" ]; then
    issues=$((issues + 1))
fi

if [ $issues -eq 0 ]; then
    print_success "All required files are present!"
    echo ""
    echo "🚀 Next steps:"
    echo "1. Start your VS Code extension development environment"
    echo "2. Check the console for FTS5 test results"
    echo "3. If you see '✅ FTS5 is working!' then you're all set!"
    echo ""
    echo "If you still get FTS5 errors, the files might not have FTS5 compiled in."
    echo "Run './scripts/build-fts5-sqljs.sh' to build custom sql.js with FTS5 support."
else
    print_error "Found $issues issue(s) that need to be resolved"
    echo ""
    echo "🔧 Recommended actions:"
    if [ ! -f "out/sql-wasm.js" ] || [ ! -f "out/sql-wasm.wasm" ]; then
        echo "1. Run './scripts/build-fts5-sqljs.sh' to build sql.js with FTS5"
        echo "2. Or copy existing FTS5-enabled files to the out/ directory"
    fi
    echo "3. Run 'npm run compile' to ensure everything is built"
    echo "4. Run this script again to verify the setup"
fi

echo ""
echo "📚 For detailed instructions, see:"
echo "   - docs/FTS5_BUILD_INSTRUCTIONS.md"
echo "   - README_FTS5_QUICKSTART.md" 