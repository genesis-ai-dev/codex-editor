#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const chokidar = require('chokidar');

// Configuration
const DEBOUNCE_TIME = 500;
const SRC_DIR = 'src';
const DIST_DIR = 'dist';

// Global state
const buildingViews = new Set();
const buildQueue = new Set();
const debounceTimers = new Map();
let discoveredViews = [];

/**
 * Discovers all available views by scanning the src directory
 * @returns {string[]} - Array of view names found in src
 */
function discoverViews() {
    try {
        if (!fs.existsSync(SRC_DIR)) {
            console.warn(`⚠️ Source directory ${SRC_DIR} not found`);
            return [];
        }

        const entries = fs.readdirSync(SRC_DIR, { withFileTypes: true });
        const views = entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .filter(name => {
                // Exclude known non-view directories
                const excludeDirs = ['components', 'shared', 'lib', 'assets', 'types'];
                if (excludeDirs.includes(name)) return false;
                
                // Check if the directory has an index.tsx file (indicates it's a view)
                const indexPath = path.join(SRC_DIR, name, 'index.tsx');
                return fs.existsSync(indexPath);
            })
            .sort();

        console.log(`🔍 Discovered ${views.length} views: ${views.join(', ')}`);
        return views;
    } catch (error) {
        console.error('❌ Error discovering views:', error.message);
        return [];
    }
}

/**
 * Validates that build commands exist for all discovered views
 * @param {string[]} views - Array of view names to validate
 * @returns {Object} - Object mapping view names to their build commands
 */
function validateBuildCommands(views) {
    const viewBuildCommands = {};
    const missingCommands = [];

    views.forEach(view => {
        const command = `pnpm run build:${view}`;
        viewBuildCommands[view] = command;
        
        // Check if the command exists in package.json
        try {
            const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            if (!packageJson.scripts || !packageJson.scripts[`build:${view}`]) {
                missingCommands.push(view);
            }
        } catch (error) {
            console.warn(`⚠️ Could not read package.json to validate build commands`);
        }
    });

    if (missingCommands.length > 0) {
        console.warn(`⚠️ Missing build commands for views: ${missingCommands.join(', ')}`);
        console.warn(`💡 Consider adding these to package.json scripts:`);
        missingCommands.forEach(view => {
            console.warn(`   "build:${view}": "cross-env APP_NAME=${view} vite build"`);
        });
    }

    return viewBuildCommands;
}

/**
 * Gets the most recent modification time from a directory tree
 * @param {string} dirPath - Directory path to scan
 * @returns {number} - Most recent modification time in milliseconds
 */
function getMostRecentModTime(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    
    let mostRecent = 0;
    
    function scanDirectory(currentPath) {
        try {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip node_modules and other excluded directories
                    if (!['node_modules', '.git', 'dist'].includes(entry.name)) {
                        scanDirectory(fullPath);
                    }
                } else if (entry.isFile()) {
                    // Check file modification time
                    const stat = fs.statSync(fullPath);
                    if (stat.mtime.getTime() > mostRecent) {
                        mostRecent = stat.mtime.getTime();
                    }
                }
            }
        } catch (error) {
            // Ignore permission errors and continue
        }
    }
    
    scanDirectory(dirPath);
    return mostRecent;
}

/**
 * Checks if a view needs to be built by comparing source and output timestamps
 * @param {string} viewName - Name of the view to check
 * @returns {Object} - Build status information
 */
function checkViewBuildStatus(viewName) {
    const viewSrcPath = path.join(SRC_DIR, viewName);
    const viewDistPath = path.join(DIST_DIR, viewName);
    const mainOutputFile = path.join(viewDistPath, 'index.js');
    
    // Check if view source directory exists
    if (!fs.existsSync(viewSrcPath)) {
        return {
            needsBuild: false,
            reason: 'source directory not found',
            status: 'missing'
        };
    }

    // Check if any build output exists
    if (!fs.existsSync(viewDistPath) || !fs.existsSync(mainOutputFile)) {
        return {
            needsBuild: true,
            reason: 'no build output found',
            status: 'missing-output'
        };
    }

    // Get source modification times
    const srcModTime = getMostRecentModTime(viewSrcPath);
    const sharedModTime = Math.max(
        getMostRecentModTime(path.join(SRC_DIR, 'components')),
        getMostRecentModTime(path.join(SRC_DIR, 'shared')),
        getMostRecentModTime(path.join(SRC_DIR, 'lib')),
        getMostRecentModTime(path.join(SRC_DIR, 'assets'))
    );
    
    // Get config file modification times
    const configFiles = ['package.json', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json'];
    const configModTime = Math.max(...configFiles.map(file => {
        if (fs.existsSync(file)) {
            return fs.statSync(file).mtime.getTime();
        }
        return 0;
    }));

    // Get build output modification time
    const outputStat = fs.statSync(mainOutputFile);
    const outputModTime = outputStat.mtime.getTime();

    // Determine the most recent source change
    const mostRecentSrcChange = Math.max(srcModTime, sharedModTime, configModTime);

    if (mostRecentSrcChange > outputModTime) {
        return {
            needsBuild: true,
            reason: 'source files newer than build output',
            status: 'outdated',
            srcTime: new Date(mostRecentSrcChange).toISOString(),
            outputTime: new Date(outputModTime).toISOString()
        };
    }

    return {
        needsBuild: false,
        reason: 'build output is up to date',
        status: 'current',
        outputTime: new Date(outputModTime).toISOString()
    };
}

/**
 * Performs initial build state analysis for all views
 * @param {string[]} views - Array of view names to analyze
 * @returns {Object} - Analysis results
 */
function analyzeInitialBuildState(views) {
    console.log('🔍 Analyzing initial build state...');
    
    const analysis = {
        needsBuild: [],
        upToDate: [],
        missing: [],
        details: {}
    };

    views.forEach(view => {
        const status = checkViewBuildStatus(view);
        analysis.details[view] = status;

        if (status.status === 'missing') {
            analysis.missing.push(view);
        } else if (status.needsBuild) {
            analysis.needsBuild.push(view);
        } else {
            analysis.upToDate.push(view);
        }
    });

    // Log analysis results
    console.log(`📊 Build state analysis complete:`);
    console.log(`   ✅ Up to date: ${analysis.upToDate.length} views`);
    console.log(`   🔨 Need rebuild: ${analysis.needsBuild.length} views`);
    console.log(`   ❓ Missing source: ${analysis.missing.length} views`);

    if (analysis.needsBuild.length > 0) {
        console.log(`   🔨 Views needing rebuild: ${analysis.needsBuild.join(', ')}`);
    }

    if (analysis.missing.length > 0) {
        console.log(`   ❓ Views with missing source: ${analysis.missing.join(', ')}`);
    }

    return analysis;
}

/**
 * Determines which views are affected by a file change
 * @param {string} filePath - The path of the changed file
 * @returns {string[]} - Array of view names that should be rebuilt
 */
function getAffectedViews(filePath) {
    const relativePath = path.relative(process.cwd(), filePath);
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    console.log(`📁 Analyzing change: ${normalizedPath}`);
    
    // If it's in a specific view directory, only rebuild that view
    const viewMatch = normalizedPath.match(/^src\/([^\/]+)\//);
    if (viewMatch) {
        const viewName = viewMatch[1];
        if (discoveredViews.includes(viewName)) {
            console.log(`🎯 Direct view match: ${viewName}`);
            return [viewName];
        }
    }
    
    // If it's in shared directories, rebuild all views
    const sharedPaths = [
        'src/components/',
        'src/shared/',
        'src/lib/',
        'src/assets/',
        'src/types/',
        'src/globals.css',
        'src/tailwind.css'
    ];
    
    const isSharedFile = sharedPaths.some(sharedPath => normalizedPath.startsWith(sharedPath));
    if (isSharedFile) {
        console.log(`🌐 Shared file detected, rebuilding all views`);
        return discoveredViews;
    }
    
    // If it's a root-level config file, rebuild all views
    const rootConfigFiles = [
        'package.json',
        'vite.config.ts',
        'tailwind.config.js',
        'postcss.config.js',
        'tsconfig.json'
    ];
    
    const isRootConfig = rootConfigFiles.some(configFile => normalizedPath.includes(configFile));
    if (isRootConfig) {
        console.log(`⚙️ Config file detected, rebuilding all views`);
        return discoveredViews;
    }
    
    // Default: if we can't determine the scope, rebuild all views to be safe
    console.log(`❓ Unknown file scope, rebuilding all views`);
    return discoveredViews;
}

/**
 * Executes a build command for a specific view
 * @param {string} viewName - The name of the view to build
 * @param {Object} buildCommands - Mapping of view names to build commands
 * @returns {Promise<void>}
 */
function buildView(viewName, buildCommands) {
    return new Promise((resolve, reject) => {
        const command = buildCommands[viewName];
        if (!command) {
            reject(new Error(`No build command found for view: ${viewName}`));
            return;
        }
        
        console.log(`🔨 Building ${viewName}...`);
        buildingViews.add(viewName);
        
        const startTime = Date.now();
        exec(command, (error, stdout, stderr) => {
            const duration = Date.now() - startTime;
            buildingViews.delete(viewName);
            
            if (error) {
                console.error(`❌ Build failed for ${viewName} (${duration}ms):`, error.message);
                if (stderr) console.error(stderr);
                reject(error);
            } else {
                console.log(`✅ Build completed for ${viewName} (${duration}ms)`);
                if (stdout && stdout.trim()) {
                    console.log(`📋 ${viewName} build output:`, stdout.trim());
                }
                resolve();
            }
        });
    });
}

/**
 * Processes the build queue
 * @param {Object} buildCommands - Mapping of view names to build commands
 */
async function processBuildQueue(buildCommands) {
    if (buildQueue.size === 0) return;
    
    const viewsToBuild = Array.from(buildQueue);
    buildQueue.clear();
    
    console.log(`🚀 Starting build for ${viewsToBuild.length} view(s): ${viewsToBuild.join(', ')}`);
    
    // Build views in parallel for better performance
    const buildPromises = viewsToBuild
        .filter(view => !buildingViews.has(view))
        .map(view => buildView(view, buildCommands).catch(error => {
            console.error(`Build failed for ${view}:`, error.message);
            return Promise.resolve(); // Continue with other builds
        }));
    
    if (buildPromises.length > 0) {
        await Promise.all(buildPromises);
        console.log(`🎉 All builds completed`);
    }
}

/**
 * Handles file changes with debouncing
 * @param {string} filePath - The path of the changed file
 * @param {Object} buildCommands - Mapping of view names to build commands
 */
function handleFileChange(filePath, buildCommands) {
    const affectedViews = getAffectedViews(filePath);
    
    // Add affected views to the build queue
    affectedViews.forEach(view => buildQueue.add(view));
    
    // Clear existing debounce timer
    if (debounceTimers.has('build')) {
        clearTimeout(debounceTimers.get('build'));
    }
    
    // Set new debounce timer
    debounceTimers.set('build', setTimeout(() => {
        processBuildQueue(buildCommands);
        debounceTimers.delete('build');
    }, DEBOUNCE_TIME));
}

/**
 * Performs initial build synchronization
 * @param {Object} analysis - Build state analysis results
 * @param {Object} buildCommands - Mapping of view names to build commands
 * @param {boolean} forceBuild - Whether to force rebuild all views
 */
async function performInitialSync(analysis, buildCommands, forceBuild = false) {
    const viewsToRebuild = forceBuild ? discoveredViews : analysis.needsBuild;
    
    if (viewsToRebuild.length === 0 && !forceBuild) {
        console.log('✅ All views are up to date, no initial builds needed');
        return;
    }

    if (forceBuild) {
        console.log('🔄 Force rebuild requested, rebuilding all views...');
    } else {
        console.log(`🔧 Performing initial synchronization for ${viewsToRebuild.length} views...`);
    }

    // Queue all views that need building
    viewsToRebuild.forEach(view => buildQueue.add(view));
    
    // Process the initial build queue
    await processBuildQueue(buildCommands);
}

/**
 * Starts the enhanced smart watch process
 * @param {Object} options - Configuration options
 */
async function startSmartWatch(options = {}) {
    const { forceBuild = false, skipInitialSync = false } = options;
    
    console.log('🔍 Starting enhanced smart watch for webviews...');
    
    // Step 1: Discover all available views
    discoveredViews = discoverViews();
    if (discoveredViews.length === 0) {
        console.error('❌ No views found to monitor. Make sure you\'re in the correct directory.');
        process.exit(1);
    }
    
    // Step 2: Validate build commands
    const buildCommands = validateBuildCommands(discoveredViews);
    
    // Step 3: Analyze initial build state
    if (!skipInitialSync) {
        const analysis = analyzeInitialBuildState(discoveredViews);
        
        // Step 4: Perform initial synchronization
        await performInitialSync(analysis, buildCommands, forceBuild);
    } else {
        console.log('⏩ Skipping initial build state analysis and synchronization');
    }
    
    console.log(`📊 Monitoring ${discoveredViews.length} views: ${discoveredViews.join(', ')}`);
    
    // Step 5: Set up file watching
    const watcher = chokidar.watch([
        'src/**/*.{ts,tsx,js,jsx,css,json}',
        'package.json',
        'vite.config.ts',
        'tailwind.config.js',
        'postcss.config.js',
        'tsconfig.json'
    ], {
        ignored: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.git/**',
            '**/.*'
        ],
        persistent: true,
        ignoreInitial: true // We handle initial state manually above
    });
    
    watcher.on('change', (filePath) => handleFileChange(filePath, buildCommands));
    watcher.on('add', (filePath) => handleFileChange(filePath, buildCommands));
    watcher.on('unlink', (filePath) => handleFileChange(filePath, buildCommands));
    
    watcher.on('ready', () => {
        console.log('✅ Smart watch is ready and monitoring for changes');
        console.log('💡 Tip: Edit files in src/ to see automatic rebuilding in action');
        console.log('🔄 Use Ctrl+C to stop gracefully');
    });
    
    watcher.on('error', error => {
        console.error('❌ Watcher error:', error);
    });
    
    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down smart watch...');
        watcher.close();
        process.exit(0);
    });
    
    // Handle uncaught exceptions gracefully
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught exception:', error);
        watcher.close();
        process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
        watcher.close();
        process.exit(1);
    });
}

// Parse command line arguments
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--force':
            case '-f':
                options.forceBuild = true;
                console.log('🔄 Force build mode enabled');
                break;
            case '--skip-initial':
            case '-s':
                options.skipInitialSync = true;
                console.log('⏩ Skipping initial synchronization');
                break;
            case '--help':
            case '-h':
                console.log(`
Enhanced Smart Watch for Webviews

Usage: node smart-watch.cjs [options]

Options:
  --force, -f        Force rebuild all views on startup
  --skip-initial, -s Skip initial build state analysis and sync
  --help, -h         Show this help message

Features:
  🔍 Auto-discovery of views in src/ directory
  📊 Build state analysis and timestamp comparison
  🔄 Initial synchronization of out-of-date builds
  🎯 Intelligent file change detection
  ⚡ Parallel building for better performance
  🛡️ Robust error handling and recovery
                `);
                process.exit(0);
                break;
            default:
                console.warn(`⚠️ Unknown argument: ${arg}`);
                break;
        }
    }
    
    return options;
}

// Start the smart watch if this script is run directly
if (require.main === module) {
    const options = parseArguments();
    startSmartWatch(options).catch(error => {
        console.error('❌ Failed to start smart watch:', error);
        process.exit(1);
    });
}

module.exports = {
    startSmartWatch,
    discoverViews,
    getAffectedViews,
    buildView,
    analyzeInitialBuildState,
    checkViewBuildStatus
}; 