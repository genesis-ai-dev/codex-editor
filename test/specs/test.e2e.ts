import { browser, expect } from '@wdio/globals';
import { setupBrowser } from '@testing-library/webdriverio';


describe('VS Code Extension Testing', () => {

    it('should successfully load VS Code with extension in non-blocking mode', async () => {
        const workbench = await browser.getWorkbench();

        // Wait for VS Code to fully load
        await browser.pause(3000);

        // Verify VS Code launched in Extension Development Host mode
        console.log('🔍 Verifying VS Code Extension Development Host...');
        expect(await workbench.getTitleBar().getTitle())
            .toContain('[Extension Development Host]');

        // With the new non-blocking startup, the UI should be ready quickly
        // and providers should be registered immediately
        console.log('✅ VS Code Extension Development Host verified');

        // Check that the workbench is accessible
        const workbenchElement = await browser.$('.monaco-workbench');
        expect(await workbenchElement.isDisplayed()).toBe(true);
        console.log('✅ VS Code workbench is accessible - non-blocking startup successful');
    });

    it('should show authentication form when ready', async () => {
        console.log('🔐 Testing authentication UI...');

        // Wait for VS Code to be ready
        await browser.pause(2000);

        // Find and switch to webview iframe
        console.log('🔍 Looking for webview iframe for authentication...');
        await browser.waitUntil(async () => {
            try {
                const webviewFrame = await browser.$('iframe.webview.ready');
                return await webviewFrame.isExisting();
            } catch {
                return false;
            }
        }, {
            timeout: 15000,
            timeoutMsg: 'Webview iframe not found for authentication step'
        });

        const webviewFrame = await browser.$('iframe.webview.ready');
        await browser.switchToFrame(webviewFrame);
        console.log('✅ Switched to webview iframe for authentication');

        // Wait for active frame
        await browser.waitUntil(async () => {
            try {
                const activeFrame = await browser.$('#active-frame');
                return await activeFrame.isExisting();
            } catch {
                return false;
            }
        }, {
            timeout: 10000,
            timeoutMsg: 'Active frame not found for authentication step'
        });

        const activeFrame = await browser.$('#active-frame');
        await browser.switchToFrame(activeFrame);
        console.log('✅ Switched to active frame for authentication');

        // Wait for authentication to appear (no longer waiting for splash to complete)
        console.log('⏳ Waiting for authentication UI to appear...');

        await browser.waitUntil(async () => {
            try {
                const bodyText = await browser.$('body').getText();
                console.log('🔍 Current content check:', bodyText.substring(0, 300) + '...');

                // Check if authentication UI is present
                return bodyText.includes('username') ||
                    bodyText.includes('password') ||
                    bodyText.includes('login') ||
                    bodyText.includes('Login') ||
                    bodyText.includes('Username') ||
                    bodyText.includes('Password') ||
                    bodyText.includes('Sign in') ||
                    bodyText.includes('Authentication') ||
                    bodyText.includes('email');
            } catch (error) {
                console.log('⚠️ Error checking for authentication content:', error instanceof Error ? error.message : String(error));
                return false;
            }
        }, {
            timeout: 30000,
            timeoutMsg: 'Authentication form did not appear',
            interval: 1000
        });

        // Get the current page content
        const authPageText = await browser.$('body').getText();
        console.log('📄 Authentication page content:', authPageText);

        // Check for authentication elements
        console.log('🔍 Checking for authentication form elements...');

        // Look for common authentication input patterns
        const authPatterns = [
            'username',
            'password',
            'email',
            'login',
            'Login',
            'Username',
            'Password',
            'Sign in',
            'Authentication'
        ];

        const foundAuthElements: string[] = [];
        for (const pattern of authPatterns) {
            if (authPageText.toLowerCase().includes(pattern.toLowerCase())) {
                foundAuthElements.push(pattern);
                console.log(`✅ Found authentication element: "${pattern}"`);
            }
        }

        // Verify we found authentication-related content
        expect(foundAuthElements.length).toBeGreaterThanOrEqual(1);
        console.log(`✅ Found ${foundAuthElements.length} authentication elements`);

        // Try to find actual input fields
        console.log('🔍 Looking for input fields...');

        // Check for various input field selectors
        const inputSelectors = [
            'input[type="text"]',
            'input[type="email"]',
            'input[type="password"]',
            'input[placeholder*="username"]',
            'input[placeholder*="email"]',
            'input[placeholder*="password"]',
            'input[name*="username"]',
            'input[name*="email"]',
            'input[name*="password"]',
            'input',
            'textarea'
        ];

        const foundInputs: string[] = [];
        for (const selector of inputSelectors) {
            try {
                const inputs = await browser.$$(selector);
                const inputCount = await inputs.length;
                if (inputCount > 0) {
                    foundInputs.push(selector);
                    console.log(`✅ Found ${inputCount} input(s) with selector: ${selector}`);

                    // Log details about the inputs
                    for (let i = 0; i < inputCount; i++) {
                        try {
                            const inputType = await inputs[i].getAttribute('type');
                            const inputPlaceholder = await inputs[i].getAttribute('placeholder');
                            const inputName = await inputs[i].getAttribute('name');
                            console.log(`  Input ${i + 1}: type="${inputType}", placeholder="${inputPlaceholder}", name="${inputName}"`);
                        } catch (error) {
                            console.log(`  Input ${i + 1}: Unable to get attributes`);
                        }
                    }
                }
            } catch (error) {
                // Selector not found, continue
            }
        }

        // Look for buttons
        console.log('🔍 Looking for authentication buttons...');
        const buttonSelectors = [
            'button',
            'input[type="submit"]',
            'a[role="button"]',
            '[role="button"]'
        ];

        const foundButtons: string[] = [];
        for (const selector of buttonSelectors) {
            try {
                const buttons = await browser.$$(selector);
                const buttonCount = await buttons.length;
                if (buttonCount > 0) {
                    foundButtons.push(selector);
                    console.log(`✅ Found ${buttonCount} button(s) with selector: ${selector}`);

                    // Log button text
                    for (let i = 0; i < buttonCount; i++) {
                        try {
                            const buttonText = await buttons[i].getText();
                            console.log(`  Button ${i + 1}: "${buttonText}"`);
                        } catch (error) {
                            console.log(`  Button ${i + 1}: Unable to get text`);
                        }
                    }
                }
            } catch (error) {
                // Selector not found, continue
            }
        }

        // Summary
        console.log('📋 Authentication Form Summary:');
        console.log(`  - Authentication elements found: ${foundAuthElements.join(', ')}`);
        console.log(`  - Input fields found: ${foundInputs.length} types`);
        console.log(`  - Buttons found: ${foundButtons.length} types`);

        // Ensure we found some authentication UI
        const hasAuthContent = foundAuthElements.length > 0;
        const hasInputFields = foundInputs.length > 0;

        expect(hasAuthContent || hasInputFields).toBe(true);
        console.log('🎯 Authentication form validation completed successfully!');

        // Switch back to main context
        await browser.switchToFrame(null);
        console.log('🔄 Switched back to main VS Code context');
    });

    it('should verify VS Code UI elements are accessible after loading', async () => {
        const workbench = await browser.getWorkbench();

        // Verify the workbench is accessible by checking its title bar
        const titleBar = await workbench.getTitleBar();
        expect(titleBar).toBeDefined();
        console.log('✅ VS Code workbench is accessible');

        // Verify we can access basic VS Code UI elements
        const workbenchElement = await browser.$('.monaco-workbench');
        expect(await workbenchElement.isDisplayed()).toBe(true);
        console.log('✅ VS Code UI elements are accessible');
    });
});
