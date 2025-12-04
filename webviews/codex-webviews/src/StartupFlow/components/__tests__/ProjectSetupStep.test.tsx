import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProjectSetupStep } from '../ProjectSetupStep';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock VSCode UI Toolkit components
vi.mock('@vscode/webview-ui-toolkit/react', () => ({
    VSCodeButton: ({ children, onClick, disabled, appearance }: any) => (
        <button onClick={onClick} disabled={disabled} data-appearance={appearance}>
            {children}
        </button>
    ),
    VSCodeTextField: ({ value, onInput, placeholder, type }: any) => (
        <input
            type={type}
            value={value}
            onChange={onInput}
            placeholder={placeholder}
        />
    ),
}));

// Mock GitLabProjectsList
vi.mock('../GitLabProjectsList', () => ({
    GitLabProjectsList: () => <div>GitLab Projects List</div>,
}));

describe('ProjectSetupStep', () => {
    const defaultProps = {
        onCreateEmpty: vi.fn(),
        onCloneRepo: vi.fn(),
        onOpenProject: vi.fn(),
        vscode: {
            postMessage: vi.fn(),
        } as any,
        isAuthenticated: false,
    };

    it('renders "Back to Login" button when not authenticated', () => {
        render(<ProjectSetupStep {...defaultProps} isAuthenticated={false} />);
        expect(screen.getByText('Back to Login')).toBeInTheDocument();
    });

    it('does not render "Back to Login" button when authenticated', () => {
        render(<ProjectSetupStep {...defaultProps} isAuthenticated={true} />);
        expect(screen.queryByText('Back to Login')).not.toBeInTheDocument();
    });

    it('renders "Back to Login" button when offline and not authenticated', () => {
        // Mock navigator.onLine
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: false,
        });

        render(<ProjectSetupStep {...defaultProps} isAuthenticated={false} />);
        expect(screen.getByText('Back to Login')).toBeInTheDocument();
    });

    it('does not render "Back to Login" button when offline but authenticated', () => {
        // Mock navigator.onLine
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            value: false,
        });

        render(<ProjectSetupStep {...defaultProps} isAuthenticated={true} />);
        expect(screen.queryByText('Back to Login')).not.toBeInTheDocument();
    });
});


