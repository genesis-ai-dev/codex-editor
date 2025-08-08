import { browser, expect } from '@wdio/globals';
import { setupBrowser } from '@testing-library/webdriverio';



describe('VS Code Extension Testing', () => {
    // Define all possible loading stages based on extension.ts analysis
    const EXPECTED_LOADING_STAGES = [
        'Initializing Splash Screen',
        'Configuring Editor Layout',
        'Setting up Pre-activation Commands',
        'Loading Project Metadata',
        'Connecting Authentication Service',
        'Setting up Basic Components',
        'Configuring Startup Workflow',
        '🤖 AI preparing search capabilities',
        '🤖 AI search capabilities (skipped - no workspace)',
        'Initializing Workspace',
        'Watching for Initialization',
        'Loading Core Components',
        'Initializing Status Bar',
        'Running Post-activation Tasks',
        'Initializing Language Server',
        '🤖 AI learning your project structure',
        'Completing Project Synchronization',
        'Failing Project Synchronization',
        'Project Synchronization Complete',
        'Project Synchronization Skipped',
        'Project Synchronization Failed'
    ];

    it('should successfully load VS Code with extension and validate all loading stages', async () => {
        const workbench = await browser.getWorkbench();

        // Wait for VS Code to fully load (longer timeout for comprehensive testing)
        await browser.pause(3000);

        // Verify VS Code launched in Extension Development Host mode
        console.log('🔍 Verifying VS Code Extension Development Host...');
        expect(await workbench.getTitleBar().getTitle())
            .toContain('[Extension Development Host]');

        // Wait for the webview to appear
        console.log('🔍 Looking for webview iframe...');
        await browser.waitUntil(async () => {
            try {
                const webviewFrame = await browser.$('iframe.webview.ready');
                return await webviewFrame.isExisting();
            } catch {
                return false;
            }
        }, {
            timeout: 20000,
            timeoutMsg: 'Webview iframe did not appear within 20 seconds'
        });

        // Switch to the webview iframe
        const webviewFrame = await browser.$('iframe.webview.ready');
        await browser.switchToFrame(webviewFrame);
        console.log('✅ Successfully switched to webview iframe');

        // Look for the inner active frame where content actually lives
        console.log('🔍 Looking for active frame inside webview...');
        await browser.waitUntil(async () => {
            try {
                const activeFrame = await browser.$('#active-frame');
                return await activeFrame.isExisting();
            } catch {
                return false;
            }
        }, {
            timeout: 15000,
            timeoutMsg: 'Active frame did not appear within 15 seconds'
        });

        // Switch to the inner active frame
        const activeFrame = await browser.$('#active-frame');
        await browser.switchToFrame(activeFrame);
        console.log('✅ Successfully switched to active frame - this is where the content is!');

        // Verify essential splash screen content
        console.log('🔍 Verifying splash screen content...');

        // Check for main loading message
        const bodyText = await browser.$('body').getText();
        console.log('📝 Active frame body text preview:', bodyText.substring(0, 200) + '...');

        expect(bodyText).toContain('Loading Codex Editor');
        console.log('✅ Found "Loading Codex Editor" text');

        // Wait a bit more for loading stages to populate
        await browser.pause(2000);

        // Get updated content after waiting
        const updatedBodyText = await browser.$('body').getText();

        // Validate core loading stages that should always be present
        const coreStages = [
            'Initializing Splash Screen',
            'Configuring Editor Layout',
            'Setting up Pre-activation Commands',
            'Loading Project Metadata'
        ];

        console.log('🔍 Checking for core loading stages...');
        const foundStages: string[] = [];
        const missingStages: string[] = [];

        for (const stage of coreStages) {
            if (updatedBodyText.includes(stage)) {
                foundStages.push(stage);
                console.log(`✅ Found core stage: "${stage}"`);
            } else {
                missingStages.push(stage);
                console.log(`❌ Missing core stage: "${stage}"`);
            }
        }

        // Ensure we found the essential core stages
        expect(foundStages.length).toBeGreaterThanOrEqual(3);
        console.log(`✅ Found ${foundStages.length} out of ${coreStages.length} core stages`);

        // Check for any additional loading stages that might be present
        console.log('🔍 Checking for additional loading stages...');
        const additionalStagesFound: string[] = [];

        for (const stage of EXPECTED_LOADING_STAGES) {
            if (!coreStages.includes(stage) && updatedBodyText.includes(stage)) {
                additionalStagesFound.push(stage);
                console.log(`✅ Found additional stage: "${stage}"`);
            }
        }

        if (additionalStagesFound.length > 0) {
            console.log(`✅ Found ${additionalStagesFound.length} additional loading stages`);
        }

        // Check for progress indication
        const progressMatches = updatedBodyText.match(/Current progress: (\d+)%/);
        if (progressMatches) {
            const progress = parseInt(progressMatches[1]);
            console.log(`📊 Current loading progress: ${progress}%`);
            expect(progress).toBeGreaterThanOrEqual(0);
            expect(progress).toBeLessThanOrEqual(100);
        }

        // Check for timing information
        const timingMatches = updatedBodyText.match(/(\d+)ms/g);
        if (timingMatches && timingMatches.length > 0) {
            console.log(`⏱️ Found ${timingMatches.length} timing measurements`);
            console.log(`⏱️ Sample timings: ${timingMatches.slice(0, 5).join(', ')}`);
        }

        // Check for stage completion indicators
        const completedStagesCount = (updatedBodyText.match(/\d+ms/g) || []).length;
        console.log(`✅ Found ${completedStagesCount} completed stages with timing`);

        // Detailed logging of all found stages
        const allFoundStages = [...foundStages, ...additionalStagesFound];
        console.log('📋 Summary of all found loading stages:');
        allFoundStages.forEach((stage, index) => {
            console.log(`  ${index + 1}. ${stage}`);
        });

        if (missingStages.length > 0) {
            console.log('⚠️ Missing core stages:');
            missingStages.forEach((stage, index) => {
                console.log(`  ${index + 1}. ${stage}`);
            });
        }

        // Verify the splash screen shows loading activity
        expect(allFoundStages.length).toBeGreaterThanOrEqual(3);
        console.log(`🎯 Final validation: Found ${allFoundStages.length} total loading stages`);

        // Switch back to main VS Code context for final verification
        await browser.switchToFrame(null);
        console.log('🔄 Switched back to main VS Code context');
    });

    it('should show authentication form after startup flow completes', async () => {
        console.log('🔐 Testing authentication step after startup flow...');

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

        // Wait for startup flow to complete and authentication to appear
        console.log('⏳ Waiting for startup flow to complete and authentication to appear...');

        // Wait longer for the loading to complete and authentication to show
        await browser.waitUntil(async () => {
            try {
                const bodyText = await browser.$('body').getText();
                console.log('🔍 Current content check:', bodyText.substring(0, 300) + '...');

                // Check if we've moved past loading to authentication
                return bodyText.includes('username') ||
                    bodyText.includes('password') ||
                    bodyText.includes('login') ||
                    bodyText.includes('Login') ||
                    bodyText.includes('Username') ||
                    bodyText.includes('Password') ||
                    bodyText.includes('Sign in') ||
                    bodyText.includes('Authentication') ||
                    bodyText.includes('email') ||
                    !bodyText.includes('Loading Codex Editor'); // Loading is done
            } catch (error) {
                console.log('⚠️ Error checking for authentication content:', error instanceof Error ? error.message : String(error));
                return false;
            }
        }, {
            timeout: 30000,
            timeoutMsg: 'Authentication form did not appear after startup flow completed',
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
        const hasButtons = foundButtons.length > 0;

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
