#!/bin/bash

# Build script for sql.js with FTS5 support
# This script automates the process of building a custom sql.js with FTS5 enabled

set -e  # Exit on any error

echo "🚀 Building sql.js with FTS5 support..."

# Configuration
SQLJS_REPO="https://github.com/sql-js/sql.js.git"
BUILD_DIR="./temp-sqljs-build"
OUTPUT_DIR="./out"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is required but not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v git &> /dev/null; then
        print_error "Git is required but not installed. Please install Git first."
        exit 1
    fi
    
    print_status "Prerequisites check passed ✅"
}

# Clone sql.js repository
clone_repo() {
    print_status "Cloning sql.js repository..."
    
    if [ -d "$BUILD_DIR" ]; then
        print_warning "Build directory exists, removing..."
        rm -rf "$BUILD_DIR"
    fi
    
    git clone "$SQLJS_REPO" "$BUILD_DIR"
    cd "$BUILD_DIR"
}

# Modify Makefile to enable FTS5
modify_makefile() {
    print_status "Modifying Makefile to enable FTS5..."
    
    # Backup original Makefile
    cp Makefile Makefile.backup
    
    # Show current CFLAGS for debugging
    print_status "Current CFLAGS in Makefile:"
    grep "CFLAGS" Makefile || echo "No CFLAGS found"
    
    # Add FTS5 flag to CFLAGS - more robust approach
    if grep -q "DSQLITE_ENABLE_FTS5" Makefile; then
        print_warning "FTS5 already enabled in Makefile"
    else
        # Find and replace the CFLAGS line more carefully
        sed -i.bak 's/-DSQLITE_ENABLE_NORMALIZE/-DSQLITE_ENABLE_NORMALIZE -DSQLITE_ENABLE_FTS5/' Makefile
        print_status "FTS5 support added to Makefile ✅"
    fi
    
    # Verify the change
    print_status "Updated CFLAGS in Makefile:"
    grep "CFLAGS" Makefile || echo "No CFLAGS found"
    
    # Also disable closure compiler to avoid build issues
    print_status "Disabling closure compiler to avoid build issues..."
    sed -i.bak2 's/--closure 1/--closure 0/' Makefile
    print_status "Closure compiler disabled ✅"
}

# Build using Docker
build_with_docker() {
    print_status "Building sql.js with Docker..."
    
    # Build the Docker container
    print_status "Building Docker container (this may take 10-15 minutes)..."
    docker build -t sqljs-fts5-build .devcontainer/
    
    # Run the build inside the container
    print_status "Running build inside container..."
    docker run --rm -v "$(pwd):/workspace" sqljs-fts5-build bash -c "
        cd /workspace
        make clean
        make
    "
}

# Copy built files
copy_files() {
    print_status "Copying built files..."
    
    # Create output directory if it doesn't exist
    mkdir -p "../$OUTPUT_DIR"
    
    # Copy the built files
    if [ -f "dist/sql-wasm.js" ] && [ -f "dist/sql-wasm.wasm" ]; then
        cp dist/sql-wasm.js "../$OUTPUT_DIR/"
        cp dist/sql-wasm.wasm "../$OUTPUT_DIR/"
        print_status "Files copied successfully ✅"
        print_status "  - sql-wasm.js"
        print_status "  - sql-wasm.wasm"
    else
        print_error "Built files not found in dist/ directory"
        exit 1
    fi
}

# Cleanup
cleanup() {
    print_status "Cleaning up..."
    cd ..
    rm -rf "$BUILD_DIR"
    print_status "Cleanup completed ✅"
}

# Verify build
verify_build() {
    print_status "Verifying FTS5 support in built files..."
    
    if command -v strings &> /dev/null; then
        if strings "$OUTPUT_DIR/sql-wasm.wasm" | grep -q "fts5"; then
            print_status "FTS5 support verified in WASM file ✅"
        else
            print_warning "Could not verify FTS5 support in WASM file"
        fi
    else
        print_warning "strings command not available, skipping verification"
    fi
    
    # Check file sizes
    print_status "File sizes:"
    ls -lh "$OUTPUT_DIR/sql-wasm.js" "$OUTPUT_DIR/sql-wasm.wasm" 2>/dev/null || true
}

# Main execution
main() {
    echo "🔧 sql.js FTS5 Build Script"
    echo "=========================="
    
    check_prerequisites
    clone_repo
    modify_makefile
    build_with_docker
    copy_files
    verify_build
    cleanup
    
    echo ""
    print_status "🎉 Build completed successfully!"
    print_status "Custom sql.js with FTS5 support is now available in the '$OUTPUT_DIR' directory."
    print_status ""
    print_status "Next steps:"
    print_status "1. Restart your VS Code extension development"
    print_status "2. Test that FTS5 is working in your extension"
    print_status "3. If needed, update your webpack.config.js to use the new files"
}

# Handle script interruption
trap cleanup EXIT

# Run main function
main "$@" 