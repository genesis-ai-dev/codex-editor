import React, { useState, useRef, useEffect } from 'react';

interface VisualPasswordInputProps {
  password: string;
  email: string;
  minLength?: number;
  placeholder?: string;
  onPasswordChange: (password: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

export const VisualPasswordInput: React.FC<VisualPasswordInputProps> = ({
  password,
  email,
  minLength = 15,
  placeholder = "Password",
  onPasswordChange,
  disabled = false,
  style = {},
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Enhanced email matching - checks for any 3+ character substring
  const getEmailMatches = (): { start: number; end: number }[] => {
    if (!email || !password || password.length < 3) return [];
    
    const matches: { start: number; end: number }[] = [];
    const lowerPassword = password.toLowerCase();
    const lowerEmail = email.toLowerCase();
    
    // Check for any 3+ character substring from the email
    for (let emailStart = 0; emailStart <= lowerEmail.length - 3; emailStart++) {
      for (let emailEnd = emailStart + 3; emailEnd <= lowerEmail.length; emailEnd++) {
        const emailSubstring = lowerEmail.substring(emailStart, emailEnd);
        
        // Skip common short words and symbols that might cause false positives
        if (emailSubstring.includes('@') || emailSubstring.includes('.') || 
            ['com', 'org', 'net', 'edu', 'gov'].includes(emailSubstring)) {
          continue;
        }
        
        // Look for this substring in the password
        for (let passStart = 0; passStart <= lowerPassword.length - emailSubstring.length; passStart++) {
          if (lowerPassword.substring(passStart, passStart + emailSubstring.length) === emailSubstring) {
            matches.push({ start: passStart, end: passStart + emailSubstring.length });
          }
        }
      }
    }
    
    // Remove overlapping matches, keeping the longest ones
    return matches.sort((a, b) => (b.end - b.start) - (a.end - a.start))
      .filter((match, index, arr) => {
        return !arr.slice(0, index).some(prev => 
          (match.start >= prev.start && match.start < prev.end) ||
          (match.end > prev.start && match.end <= prev.end)
        );
      });
  };

  const emailMatches = getEmailMatches();
  const hasEmailMatch = emailMatches.length > 0;
  const isLengthValid = password.length >= minLength;
  const allRequirementsMet = isLengthValid && !hasEmailMatch;

  // Render the visual overlay
  const renderOverlay = () => {
    if (!isFocused && !password) return null;

    const chars = password.split('');
    const elements: JSX.Element[] = [];

    // Create character elements with highlighting
    chars.forEach((char, index) => {
      const isInEmailMatch = emailMatches.some(match => index >= match.start && index < match.end);
      const charColor = allRequirementsMet ? 'var(--vscode-testing-iconPassed)' : 
                       isInEmailMatch ? 'var(--vscode-errorForeground)' : 
                       'var(--vscode-foreground)';
      
      elements.push(
        <span
          key={`char-${index}`}
          style={{
            color: charColor,
            backgroundColor: isInEmailMatch ? 'var(--vscode-errorForeground)' : 'transparent',
            padding: isInEmailMatch ? '0 1px' : '0',
            borderRadius: isInEmailMatch ? '2px' : '0',
            fontFamily: 'inherit',
            fontSize: 'inherit',
          }}
        >
          •
        </span>
      );
    });

    // Add remaining dots for unfilled positions
    for (let i = password.length; i < minLength; i++) {
      elements.push(
        <span
          key={`dot-${i}`}
          style={{
            color: 'var(--vscode-errorForeground)',
            opacity: 0.5,
            fontFamily: 'inherit',
            fontSize: 'inherit',
          }}
        >
          •
        </span>
      );
    }

    return (
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          fontFamily: 'monospace',
          fontSize: '16px',
          lineHeight: '1',
          zIndex: 1,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {elements}
      </div>
    );
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPasswordChange(e.target.value);
  };

  return (
    <div style={{ position: 'relative', width: '100%', ...style }}>
      {/* Actual input field */}
      <input
        ref={inputRef}
        type="password"
        value={password}
        onChange={handleInputChange}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '8px',
          border: `1px solid var(--vscode-input-border)`,
          borderRadius: '4px',
          backgroundColor: 'var(--vscode-input-background)',
          color: 'transparent', // Hide the actual text
          fontSize: '16px',
          fontFamily: 'monospace',
          outline: 'none',
          boxSizing: 'border-box',
          position: 'relative',
          zIndex: 0,
        }}
      />
      
      {/* Visual overlay */}
      {renderOverlay()}
      
      {/* Status indicators below input */}
      <div style={{ marginTop: '8px', fontSize: '0.85em' }}>
        {/* Length indicator */}
        <div style={{ 
          color: isLengthValid ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-descriptionForeground)',
          marginBottom: '4px'
        }}>
          Length: {password.length}/{minLength} characters
        </div>
        
        {/* Email match warning */}
        {hasEmailMatch && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--vscode-errorForeground)',
            fontSize: '0.85em',
            marginBottom: '4px'
          }}>
            <span style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: 'var(--vscode-errorForeground)',
              color: 'var(--vscode-editor-background)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 'bold'
            }}>
              !
            </span>
            Password should not contain parts of your email
          </div>
        )}

        {/* Success indicator */}
        {allRequirementsMet && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--vscode-testing-iconPassed)',
            fontSize: '0.85em',
            fontWeight: 'bold'
          }}>
            <span style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: 'var(--vscode-testing-iconPassed)',
              color: 'var(--vscode-editor-background)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
            }}>
              ✓
            </span>
            Password meets all requirements
          </div>
        )}
      </div>
    </div>
  );
};

// Updated password validation function with enhanced email matching
export const validateVisualPassword = (
  password: string, 
  email: string, 
  minLength: number = 15
): { isValid: boolean; issues: string[] } => {
  const issues: string[] = [];
  
  if (password.length < minLength) {
    issues.push(`Password must be at least ${minLength} characters long`);
  }
  
  if (email && password.length >= 3) {
    const lowerPassword = password.toLowerCase();
    const lowerEmail = email.toLowerCase();
    
    // Check for any 3+ character substring from the email
    let hasMatch = false;
    for (let emailStart = 0; emailStart <= lowerEmail.length - 3 && !hasMatch; emailStart++) {
      for (let emailEnd = emailStart + 3; emailEnd <= lowerEmail.length; emailEnd++) {
        const emailSubstring = lowerEmail.substring(emailStart, emailEnd);
        
        // Skip common short words and symbols
        if (emailSubstring.includes('@') || emailSubstring.includes('.') || 
            ['com', 'org', 'net', 'edu', 'gov'].includes(emailSubstring)) {
          continue;
        }
        
        if (lowerPassword.includes(emailSubstring)) {
          hasMatch = true;
          break;
        }
      }
    }
    
    if (hasMatch) {
      issues.push('Password should not contain parts of your email');
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}; 