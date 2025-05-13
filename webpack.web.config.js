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
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
        fallback: {
            path: require.resolve('path-browserify'),
            fs: false,
            crypto: require.resolve('crypto-browserify'),
            stream: require.resolve('stream-browserify'),
            buffer: require.resolve('buffer/'),
            util: require.resolve('util/'),
            process: require.resolve('process/browser'),
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
        ],
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser',
            Buffer: ['buffer', 'Buffer'],
        }),
    ],
    devtool: 'nosources-source-map',
};

module.exports = webConfig; 