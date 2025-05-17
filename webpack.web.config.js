const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration} */
const extensionConfig = {
    name: 'web-extension',
    target: 'webworker',
    mode: 'none',
    entry: './src/extension.web.ts',
    output: {
        path: path.resolve(__dirname, 'out'),
        filename: 'extension.web.js',
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../../[resource-path]'
    },
    externals: {
        vscode: 'commonjs vscode',
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            '@': path.resolve(__dirname, 'src'),
            'process/browser': require.resolve('process/browser'),
            'isomorphic-git': path.resolve(__dirname, 'node_modules/isomorphic-git/dist/bundle.umd.min.js')
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
            timers: false,
            'isomorphic-git': false,
            url: require.resolve('url/'),
            assert: require.resolve('assert/'),
            http: require.resolve('stream-http'),
            https: require.resolve('https-browserify'),
            net: false,
            tls: false,
            child_process: false,
            readline: false,
            dns: false,
            dgram: false
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
                        options: {
                            configFile: 'tsconfig.web.json',
                            compilerOptions: {
                                module: 'es2020'
                            }
                        }
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
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
            'process.type': JSON.stringify(process.type),
            'process.version': JSON.stringify(process.version),
        }),
    ],
    devtool: 'source-map',
    performance: {
        hints: false
    }
};

const testConfig = {
    name: 'web-tests',
    target: 'webworker',
    mode: 'none',
    entry: './src/test/suite/index.ts',
    output: {
        path: path.resolve(__dirname, 'out/test/suite'),
        filename: 'index.js',
        libraryTarget: 'commonjs2',
        devtoolModuleFilenameTemplate: '../../../[resource-path]'
    },
    externals: {
        vscode: 'commonjs vscode',
        mocha: 'commonjs mocha'
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            '@': path.resolve(__dirname, 'src'),
            'process/browser': require.resolve('process/browser'),
            'isomorphic-git': path.resolve(__dirname, 'node_modules/isomorphic-git/dist/bundle.umd.min.js'),
            'mocha': require.resolve('mocha/mocha.js')
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
            timers: false,
            'isomorphic-git': false,
            url: require.resolve('url/'),
            assert: require.resolve('assert/'),
            http: require.resolve('stream-http'),
            https: require.resolve('https-browserify'),
            net: false,
            tls: false,
            child_process: false,
            readline: false,
            dns: false,
            dgram: false
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
                        options: {
                            configFile: 'tsconfig.web.json',
                            compilerOptions: {
                                module: 'es2020'
                            }
                        }
                    },
                ],
            },
        ],
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process/browser',
            Buffer: ['buffer', 'Buffer'],
            mocha: 'mocha'
        }),
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
            'process.type': JSON.stringify(process.type),
            'process.version': JSON.stringify(process.version),
        }),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: require.resolve('mocha/mocha.js'),
                    to: 'mocha.js'
                },
                {
                    from: require.resolve('mocha/mocha.css'),
                    to: 'mocha.css'
                }
            ]
        })
    ],
    devtool: 'source-map',
    performance: {
        hints: false
    }
};

module.exports = [extensionConfig, testConfig]; 