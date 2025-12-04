import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { LoginRegisterStep } from '../LoginRegisterStep';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock VSCode UI Toolkit components
vi.mock('@vscode/webview-ui-toolkit/react', () => ({
    VSCodeButton: ({ children, onClick, disabled, appearance }: any) => (
        <button onClick={onClick} disabled={disabled} data-appearance={appearance}>
            {children}
        </button>
    ),
    VSCodeTextField: ({ value, onInput, placeholder, type, disabled }: any) => (
        <input
            type={type}
            value={value}
            onChange={onInput}
            placeholder={placeholder}
            disabled={disabled}
        />
    ),
    VSCodeProgressRing: () => <div>Loading...</div>,
    VSCodeBadge: ({ children }: any) => <span>{children}</span>,
}));

// Mock PasswordDotsIndicator
vi.mock('../../components/PasswordDotsIndicator', () => ({
    PasswordDotsIndicator: () => <div>Password Dots</div>,
    validateVisualPassword: () => ({ isValid: true, issues: [] }),
}));

describe('LoginRegisterStep', () => {
    const defaultProps = {
        authState: {
            isLoading: false,
            isAuthExtensionInstalled: true,
            isAuthenticated: false,
            error: undefined,
            gitlabInfo: undefined,
            workspaceState: {
                isWorkspaceOpen: false,
                isProjectInitialized: false,
            },
        },
        vscode: {
            postMessage: vi.fn(),
        } as any,
        onLogin: vi.fn(),
        onRegister: vi.fn(),
        onLogout: vi.fn(),
        onSkip: vi.fn(),
    };

    it('renders login form by default', () => {
        render(<LoginRegisterStep {...defaultProps} />);
        expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
        expect(screen.getByText('Login', { selector: 'button' })).toBeInTheDocument();
    });

    it('renders offline banner when navigator is offline', () => {
        // Mock navigator.onLine
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: false,
        });

        render(<LoginRegisterStep {...defaultProps} />);
        expect(screen.getByText(/You appear to be offline/)).toBeInTheDocument();
    });

    it('does not render offline banner when navigator is online', () => {
        // Mock navigator.onLine
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: true,
        });

        render(<LoginRegisterStep {...defaultProps} />);
        expect(screen.queryByText(/You appear to be offline/)).not.toBeInTheDocument();
    });

    it('renders "Skip Login" button with secondary appearance', () => {
        render(<LoginRegisterStep {...defaultProps} />);
        const skipButton = screen.getByText('Skip Login').closest('button');
        expect(skipButton).toHaveAttribute('data-appearance', 'secondary');
    });

    it('toggles between login and register', () => {
        render(<LoginRegisterStep {...defaultProps} />);
        
        // Switch to register
        fireEvent.click(screen.getByText('Create Account'));
        expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Confirm Password')).toBeInTheDocument();
        expect(screen.getByText('Register', { selector: 'button' })).toBeInTheDocument();

        // Switch back to login
        fireEvent.click(screen.getByText('Back to Login'));
        expect(screen.queryByPlaceholderText('Email')).not.toBeInTheDocument();
        expect(screen.getByText('Login', { selector: 'button' })).toBeInTheDocument();
    });

    it('disables login inputs and button when offline', () => {
        // Mock navigator.onLine
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: false,
        });

        render(<LoginRegisterStep {...defaultProps} />);
        
        expect(screen.getByPlaceholderText('Username')).toBeDisabled();
        expect(screen.getByPlaceholderText('Password')).toBeDisabled();
        expect(screen.getByText('Login', { selector: 'button' }).closest('button')).toBeDisabled();
    });

    it('does not disable "Skip Login" button when offline', () => {
        // Mock navigator.onLine
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: false,
        });

        render(<LoginRegisterStep {...defaultProps} />);
        
        const skipButton = screen.getByText('Skip Login').closest('button');
        expect(skipButton).not.toBeDisabled();
    });
});
