const path = require('path');

module.exports = {
    extensionDevelopmentPath: path.resolve(__dirname, '.'),
    extensionTestsPath: path.resolve(__dirname, './out/test/suite/index'),
    launchArgs: ['--disable-extensions'],
    browserType: 'chromium',
    serverOptions: {
        port: process.env.WEB_TEST_PORT || 3000
    },
    // Add these options to help with debugging
    debug: true,
    logLevel: 'debug',
    // Add configuration for loading additional scripts
    testRunnerOptions: {
        scripts: [
            path.resolve(__dirname, 'out/test/suite/mocha.js')
        ],
        styles: [
            path.resolve(__dirname, 'out/test/suite/mocha.css')
        ]
    }
}; 