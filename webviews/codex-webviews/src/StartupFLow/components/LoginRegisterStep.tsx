import React, { useState } from 'react';
import { VSCodeButton, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import { LoginRegisterStepProps } from '../types';

export const LoginRegisterStep: React.FC<LoginRegisterStepProps> = ({
    authState,
    onLogin,
    onRegister,
    onLogout,
    onSkip
}) => {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isRegistering) {
            onRegister(username, email, password);
        } else {
            onLogin(username, password);
        }
    };

    if (authState.isAuthenticated) {
        return (
            <div className="login-register-step">
                <h2>Welcome, {authState.gitlabInfo?.username || 'User'}!</h2>
                <VSCodeButton onClick={onLogout}>Logout</VSCodeButton>
            </div>
        );
    }

    return (
        <div className="login-register-step">
            <h2>{isRegistering ? 'Register' : 'Login'}</h2>
            <form onSubmit={handleSubmit}>
                <VSCodeTextField
                    value={username}
                    onChange={(e) => setUsername((e.target as HTMLInputElement).value)}
                    placeholder="Username"
                    required
                />
                {isRegistering && (
                    <VSCodeTextField
                        type="email"
                        value={email}
                        onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                        placeholder="Email"
                        required
                    />
                )}
                <VSCodeTextField
                    type="password"
                    value={password}
                    onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                    placeholder="Password"
                    required
                />
                <div className="button-group">
                    <VSCodeButton type="submit">
                        {isRegistering ? 'Register' : 'Login'}
                    </VSCodeButton>
                    <VSCodeButton onClick={() => setIsRegistering(!isRegistering)} appearance="secondary">
                        {isRegistering ? 'Back to Login' : 'Create Account'}
                    </VSCodeButton>
                    {!isRegistering && (
                        <VSCodeButton onClick={onSkip} appearance="secondary">
                            Skip
                        </VSCodeButton>
                    )}
                </div>
            </form>
        </div>
    );
};
