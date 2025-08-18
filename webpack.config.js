/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

"use strict";

const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
    name: "extension",
    target: "node", // VS Code extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
    mode: "none", // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

    entry: "./src/extension.ts", // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
    output: {
        // the bundle is stored in the 'out' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
        path: path.resolve(__dirname, "out"),
        filename: "extension.js",
        libraryTarget: "commonjs2",
    },
    externals: {
        vscode: "commonjs vscode", // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
        // modules added here also need to be added in the .vscodeignore file
        "fts5-sql-bundle": "commonjs fts5-sql-bundle",
        vm: "commonjs vm",
        encoding: "commonjs encoding",
    },
    resolve: {
        // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
        extensions: [".ts", ".js", ".mjs"],
        alias: {
            "@": path.resolve(__dirname, "src"),
            "@types": path.resolve(__dirname, "types"),
            "@newSourceUploaderTypes": path.resolve(
                __dirname,
                "webviews/codex-webviews/src/NewSourceUploader/types.ts"
            ),
            sqldb: path.resolve(__dirname, "src/sqldb"),
        },
        fallback: {
            path: false,
            fs: false,
            crypto: require.resolve("crypto-browserify"),
            stream: require.resolve("stream-browserify"),
            buffer: require.resolve("buffer/"),
            util: require.resolve("util/"),
            vm: false,
            readline: false,
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: "ts-loader",
                    },
                ],
            },
            {
                test: /\.md$/,
                use: [
                    {
                        loader: "html-loader",
                    },
                    {
                        loader: "markdown-loader",
                        options: {},
                    },
                ],
            },
            {
                test: /\.mjs$/,
                include: /node_modules/,
                type: "javascript/auto",
            },
            {
                test: /\.wasm$/,
                type: "asset/resource",
            },
        ],
    },
    devtool: "nosources-source-map",
    infrastructureLogging: {
        level: "log", // enables logging required for problem matchers
    },
    experiments: {
        asyncWebAssembly: true,
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ["buffer", "Buffer"],
        }),
        new webpack.DefinePlugin({
            "process.env.NODE_ENV": JSON.stringify("production"),
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: "node_modules/fts5-sql-bundle/dist/sql-wasm.wasm",
                    to: "node_modules/fts5-sql-bundle/dist/sql-wasm.wasm",
                },
                {
                    from: "node_modules/fts5-sql-bundle/dist/sql-wasm.js",
                    to: "node_modules/fts5-sql-bundle/dist/sql-wasm.js",
                },
                {
                    from: "node_modules/fts5-sql-bundle/dist/index.js",
                    to: "node_modules/fts5-sql-bundle/dist/index.js",
                },
                {
                    from: "node_modules/fts5-sql-bundle/package.json",
                    to: "node_modules/fts5-sql-bundle/package.json",
                }
            ],
        }),
    ],
    optimization: {
        minimize: false,
    },
    ignoreWarnings: [
        {
            module: /node_modules\/vscode-languageserver-types/,
        },
        {
            module: /node_modules\/mocha/,
        },
    ],
};

const serverConfig = {
    name: "server",
    target: "node",
    mode: "none",
    entry: "./src/tsServer/server.ts",
    output: {
        path: path.resolve(__dirname, "out"),
        filename: "server.js",
        libraryTarget: "commonjs2",
    },
    node: {
        __dirname: false,
        __filename: false,
        global: false,
    },
    externals: {
        vscode: "commonjs vscode",
    },
    resolve: {
        extensions: [".ts", ".js"],
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: "ts-loader",
                    },
                ],
            },
        ],
    },
    devtool: "nosources-source-map",
};

const testConfig = {
    name: "test",
    target: "webworker",
    mode: "none",
    entry: "./src/test/suite/index.ts",
    output: {
        path: path.resolve(__dirname, "out", "test", "suite"),
        filename: "index.js",
        libraryTarget: "commonjs2",
    },
    externals: {
        vscode: "commonjs vscode",
    },
    resolve: {
        extensions: [".ts", ".js"],
        alias: {
            "@": path.resolve(__dirname, "src"),
            "fs/promises": "memfs",
            "process/browser": require.resolve("process/browser"),
        },
        fallback: {
            assert: require.resolve("assert/"),
            url: require.resolve("url/"),
            fs: require.resolve("memfs"),
            zlib: require.resolve("browserify-zlib"),
            stream: require.resolve("stream-browserify"),
            util: require.resolve("util/"),
            os: require.resolve("os-browserify/browser"),
            crypto: require.resolve("crypto-browserify"),
            vm: require.resolve("vm-browserify"),
            readline: require.resolve("readline-browserify"),
            process: require.resolve("process/browser"),
            timers: require.resolve("timers-browserify"),
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: "ts-loader",
            },
            // Add this new rule for Markdown files
            {
                test: /\.md$/,
                use: [
                    {
                        loader: "html-loader",
                    },
                    {
                        loader: "markdown-loader",
                        options: {},
                    },
                ],
            },
            // ... other rules
        ],
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: require.resolve("process/browser"),
        }),
        new webpack.DefinePlugin({
            "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
        }),
        // ... other plugins if necessary
    ],
    devtool: "nosources-source-map",
    node: {
        global: true,
    },
};

const runTestConfig = {
    name: "runTest",
    target: "node",
    mode: "none",
    entry: "./src/test/runTest.ts",
    output: {
        path: path.resolve(__dirname, "out", "test"),
        filename: "runTest.js",
        libraryTarget: "commonjs2",
    },
    externals: {
        vscode: "commonjs vscode",
    },
    resolve: {
        extensions: [".ts", ".js"],
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: "ts-loader",
            },
        ],
    },
    devtool: "nosources-source-map",
};

module.exports = [extensionConfig, serverConfig, testConfig, runTestConfig];
