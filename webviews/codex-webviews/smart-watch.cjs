#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const chokidar = require('chokidar');

// Define all the views that can be built
const VIEWS = [
    'StartupFlow',
    'ParallelView', 
    'CodexCellEditor',
    'CommentsView',
    'NavigationView',
    'EditableReactTable',
    'SourceUpload',
    'MainMenu',
    'SplashScreen',
    'CellLabelImporterView',
    'NewSourceUploader'
];

// Map of view directories to their build commands
const VIEW_BUILD_COMMANDS = VIEWS.reduce((acc, view) => {
    acc[view] = `pnpm run build:${view}`;
    return acc;
}, {});

// Track which views are currently building to avoid duplicate builds
const buildingViews = new Set();
const buildQueue = new Set();

// Debounce time in milliseconds
const DEBOUNCE_TIME = 500;
const debounceTimers = new Map();

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
        if (VIEWS.includes(viewName)) {
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
        return VIEWS;
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
        return VIEWS;
    }
    
    // Default: if we can't determine the scope, rebuild all views to be safe
    console.log(`❓ Unknown file scope, rebuilding all views`);
    return VIEWS;
}

/**
 * Executes a build command for a specific view
 * @param {string} viewName - The name of the view to build
 * @returns {Promise<void>}
 */
function buildView(viewName) {
    return new Promise((resolve, reject) => {
        const command = VIEW_BUILD_COMMANDS[viewName];
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
                if (stdout) console.log(stdout);
                resolve();
            }
        });
    });
}

/**
 * Processes the build queue
 */
async function processBuildQueue() {
    if (buildQueue.size === 0) return;
    
    const viewsToBuild = Array.from(buildQueue);
    buildQueue.clear();
    
    console.log(`🚀 Starting build for ${viewsToBuild.length} view(s): ${viewsToBuild.join(', ')}`);
    
    // Build views in parallel for better performance
    const buildPromises = viewsToBuild
        .filter(view => !buildingViews.has(view))
        .map(view => buildView(view).catch(error => {
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
 */
function handleFileChange(filePath) {
    const affectedViews = getAffectedViews(filePath);
    
    // Add affected views to the build queue
    affectedViews.forEach(view => buildQueue.add(view));
    
    // Clear existing debounce timer
    if (debounceTimers.has('build')) {
        clearTimeout(debounceTimers.get('build'));
    }
    
    // Set new debounce timer
    debounceTimers.set('build', setTimeout(() => {
        processBuildQueue();
        debounceTimers.delete('build');
    }, DEBOUNCE_TIME));
}

/**
 * Starts the smart watch process
 */
function startSmartWatch() {
    console.log('🔍 Starting smart watch for webviews...');
    console.log(`📊 Monitoring ${VIEWS.length} views: ${VIEWS.join(', ')}`);
    
    // Watch for file changes
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
        ignoreInitial: true
    });
    
    watcher.on('change', handleFileChange);
    watcher.on('add', handleFileChange);
    watcher.on('unlink', handleFileChange);
    
    watcher.on('ready', () => {
        console.log('✅ Smart watch is ready and monitoring for changes');
        console.log('💡 Tip: Edit files in src/ to see automatic rebuilding in action');
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
}

// Start the smart watch if this script is run directly
if (require.main === module) {
    startSmartWatch();
}

module.exports = {
    startSmartWatch,
    getAffectedViews,
    buildView,
    VIEWS
}; 