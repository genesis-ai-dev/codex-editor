const path = require('path');
const webpack = require('webpack');

/** @type {import('webpack').Configuration} */
const webConfig = {
    name: 'web-extension',
    target: 'webworker',
    mode: 'none',
    entry: './src/extension.web.ts',
    output: {
        path: path.resolve(__dirname, 'out'),
        filename: 'extension.web.js',
        libraryTarget: 'commonjs2',
    },
    externals: {
        vscode: 'commonjs vscode',
        // Mark shared-state-store as external
        'project-accelerate.shared-state-store': 'commonjs project-accelerate.shared-state-store'
    },
    resolve: {
        extensions: ['.ts', '.js', '.mjs', '.json'],
        alias: {
            '@': path.resolve(__dirname, 'src'),
            'isomorphic-git': false,
            'xlsx': false,
        },
        fallback: {
            path: require.resolve('path-browserify'),
            fs: false,
            crypto: require.resolve('crypto-browserify'),
            stream: require.resolve('stream-browserify'),
            buffer: require.resolve('buffer/'),
            util: require.resolve('util/'),
            process: require.resolve('process/browser'),
            vm: false,
            zlib: false,
            os: false,
            timers: false
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                    },
                ],
            },
            // Handle .mjs files
            {
                test: /\.mjs$/,
                include: /node_modules/,
                type: 'javascript/auto',
            },
            // Add a rule to ignore problematic modules
            {
                test: /node_modules[\\\/](isomorphic-git|xlsx)[\\\/]/,
                use: 'null-loader',
            }
        ],
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser',
            Buffer: ['buffer', 'Buffer'],
        }),
        new webpack.DefinePlugin({
            'process.env.EXTENSION_DEPENDENCIES': JSON.stringify(['project-accelerate.shared-state-store']),
            'process.env.WEB_EXTENSION': JSON.stringify(true)
        }),
        // Add a plugin to ignore certain modules that cause problems
        new webpack.IgnorePlugin({
            resourceRegExp: /^(isomorphic-git|xlsx)$/
        })
    ],
    devtool: 'nosources-source-map',
};

module.exports = webConfig; 