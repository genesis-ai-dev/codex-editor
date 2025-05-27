# Building sql.js with FTS5 Support

## Problem
The standard sql.js build doesn't include FTS5 (Full Text Search 5) extension, which causes the error:
```
Failed to activate Codex Editor: Error: no such module: fts5
```

## Solution: Custom Build with FTS5

### Prerequisites
- Docker
- VS Code (optional, for containerized development)
- Git
- Node.js and npm

### Method 1: Using VS Code Dev Container (Recommended)

1. **Clone the sql.js repository:**
   ```bash
   git clone https://github.com/sql-js/sql.js.git
   cd sql.js
   ```

2. **Open in VS Code with Dev Container:**
   - Open the sql.js folder in VS Code
   - VS Code will detect the `.devcontainer/devcontainer.json` and prompt to reopen in container
   - Click "Reopen in Container" when prompted
   - Wait for the container to build (this may take 10-15 minutes the first time)

3. **Modify the Makefile to enable FTS5:**
   In the container, edit the `Makefile` and find the `CFLAGS` section around line 20-30:
   ```makefile
   # Find this line:
   CFLAGS = -O2 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_DISABLE_LFS \
   
   # Add FTS5 support:
   CFLAGS = -O2 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_DISABLE_LFS \
            -DSQLITE_ENABLE_FTS5 \
   ```

4. **Build sql.js:**
   ```bash
   make clean
   make
   ```
   
   Note: If `npm run rebuild` doesn't work, run `make` directly.

5. **Copy the built files:**
   The built files will be in the `dist/` directory:
   - `sql-wasm.js`
   - `sql-wasm.wasm`

### Method 2: Manual Docker Setup

If you prefer not to use VS Code:

1. **Clone and setup:**
   ```bash
   git clone https://github.com/sql-js/sql.js.git
   cd sql.js
   ```

2. **Build the Docker container:**
   ```bash
   docker build -t sqljs-build .devcontainer/
   ```

3. **Run the container with volume mount:**
   ```bash
   docker run -it -v $(pwd):/workspace sqljs-build bash
   ```

4. **Inside the container, modify Makefile and build:**
   ```bash
   cd /workspace
   # Edit Makefile to add -DSQLITE_ENABLE_FTS5
   make clean
   make
   ```

### Method 3: Local Build (Advanced)

If you have Emscripten installed locally:

1. **Install Emscripten:**
   Follow instructions at https://emscripten.org/docs/getting_started/downloads.html

2. **Clone and build:**
   ```bash
   git clone https://github.com/sql-js/sql.js.git
   cd sql.js
   # Edit Makefile to add -DSQLITE_ENABLE_FTS5
   make clean
   make
   ```

## Integrating the Custom Build

### Step 1: Copy Files to Your Project

1. **Copy the built files from `sql.js/dist/` to your project:**
   ```bash
   cp sql.js/dist/sql-wasm.js codex-editor/out/
   cp sql.js/dist/sql-wasm.wasm codex-editor/out/
   ```

### Step 2: Update Webpack Configuration

Ensure your `webpack.config.js` is correctly configured to copy the WASM file:

```javascript
new CopyWebpackPlugin({
    patterns: [
        {
            from: "out/sql-wasm.wasm", // Use your custom build
            to: "sql-wasm.wasm",
        },
    ],
}),
```

### Step 3: Test FTS5 Support

Add this test to verify FTS5 is working:

```javascript
// Add to src/sqldb/index.ts or create a test file
export function testFTS5Support(db: Database): boolean {
    try {
        db.exec(`
            CREATE VIRTUAL TABLE test_fts USING fts5(content);
            INSERT INTO test_fts VALUES ('hello world');
            SELECT * FROM test_fts WHERE test_fts MATCH 'hello';
            DROP TABLE test_fts;
        `);
        console.log("✅ FTS5 is working!");
        return true;
    } catch (error) {
        console.error("❌ FTS5 still not available:", error);
        return false;
    }
}
```

### Step 4: Update Your Extension Activation

Modify your extension activation to test FTS5:

```javascript
// In src/extension.ts, after initializing the database
if (global.db) {
    const fts5Works = testFTS5Support(global.db);
    if (!fts5Works) {
        vscode.window.showWarningMessage(
            "FTS5 not available. Some search features may be limited."
        );
    }
}
```

## Alternative: Pre-built FTS5 Versions

If building yourself is too complex, consider these alternatives:

### Option A: sqlean.js
```bash
npm install @antonz/sqlean
```
Then update your imports to use sqlean instead of sql.js.

### Option B: Community Builds
- Check GitHub for repositories like `nay-kang/sqlite3_fts_libsimple`
- Look for pre-built WASM files with FTS5 support

## Troubleshooting

### Build Issues
- **Container build fails**: Ensure Docker has enough memory (4GB+)
- **Make fails**: Try `make clean` first, then `make`
- **Permission issues**: Ensure proper file permissions in mounted volumes

### Runtime Issues
- **WASM file not found**: Check that the WASM file is in the correct location
- **FTS5 still not working**: Verify the Makefile was correctly modified
- **Performance issues**: FTS5 may be slower than expected on large datasets

### Verification Commands
```bash
# Check if FTS5 was compiled in
strings sql-wasm.wasm | grep -i fts5

# Check file sizes (FTS5 build should be larger)
ls -la dist/
```

## Maintenance

- **Updating SQLite**: When sql.js updates, you'll need to rebuild
- **Version control**: Consider committing your custom build files
- **Documentation**: Keep track of which version and modifications you used

## Performance Considerations

- FTS5 builds are larger (~200KB+ increase)
- Initial load time may be slightly longer
- Search performance should be significantly better for text searches
- Consider lazy loading if bundle size is a concern 