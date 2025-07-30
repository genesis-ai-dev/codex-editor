import React from 'react';

interface VisualPasswordIndicatorProps {
  password: string;
  email: string;
  minLength?: number;
  showIndicator?: boolean;
}

export const VisualPasswordIndicator: React.FC<VisualPasswordIndicatorProps> = ({
  password,
  email,
  minLength = 15,
  showIndicator = true,
}) => {
  if (!showIndicator) {
    return null;
  }

  // Check if password contains any part of the email (case-insensitive)
  const getEmailMatches = (): { start: number; end: number }[] => {
    if (!email || !password) return [];
    
    const matches: { start: number; end: number }[] = [];
    const lowerPassword = password.toLowerCase();
    const emailParts = email.toLowerCase().split('@');
    
    // Check for username part (before @)
    if (emailParts[0] && emailParts[0].length >= 3) {
      for (let i = 0; i <= lowerPassword.length - emailParts[0].length; i++) {
        if (lowerPassword.substring(i, i + emailParts[0].length) === emailParts[0]) {
          matches.push({ start: i, end: i + emailParts[0].length });
        }
      }
    }
    
    return matches;
  };

  const emailMatches = getEmailMatches();
  const hasEmailMatch = emailMatches.length > 0;
  const isLengthValid = password.length >= minLength;
  const allRequirementsMet = isLengthValid && !hasEmailMatch;

  // Render password with highlighting
  const renderPasswordWithHighlighting = () => {
    if (!password) return null;

    const result: JSX.Element[] = [];
    let lastIndex = 0;

    // Add email match highlighting
    emailMatches.forEach((match, idx) => {
      // Add text before match
      if (lastIndex < match.start) {
        result.push(
          <span 
            key={`before-${idx}`}
            style={{ 
              color: allRequirementsMet ? 'var(--vscode-testing-iconPassed)' : 'inherit'
            }}
          >
            {password.substring(lastIndex, match.start)}
          </span>
        );
      }
      
      // Add highlighted match
      result.push(
        <span 
          key={`match-${idx}`}
          style={{ 
            backgroundColor: 'var(--vscode-errorForeground)',
            color: 'var(--vscode-editor-background)',
            padding: '1px 2px',
            borderRadius: '2px'
          }}
        >
          {password.substring(match.start, match.end)}
        </span>
      );
      
      lastIndex = match.end;
    });

    // Add remaining text after last match
    if (lastIndex < password.length) {
      result.push(
        <span 
          key="after"
          style={{ 
            color: allRequirementsMet ? 'var(--vscode-testing-iconPassed)' : 'inherit'
          }}
        >
          {password.substring(lastIndex)}
        </span>
      );
    }

    return result;
  };

  // Render length indicator dots
  const renderLengthIndicator = () => {
    const dots = [];
    const currentLength = password.length;
    
    for (let i = 0; i < minLength; i++) {
      const isFilled = i < currentLength;
      dots.push(
        <div
          key={i}
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: isFilled 
              ? 'var(--vscode-testing-iconPassed)' 
              : 'var(--vscode-errorForeground)',
            margin: '0 2px',
            transition: 'background-color 0.2s ease',
          }}
        />
      );
    }
    
    return dots;
  };

  return (
    <div style={{ marginTop: '8px', fontSize: '0.9em' }}>
      {/* Password visualization */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ 
          marginBottom: '8px', 
          color: 'var(--vscode-descriptionForeground)',
          fontSize: '0.85em'
        }}>
          Password:
        </div>
        <div style={{
          fontFamily: 'monospace',
          fontSize: '0.9em',
          padding: '4px 8px',
          backgroundColor: 'var(--vscode-input-background)',
          border: '1px solid var(--vscode-input-border)',
          borderRadius: '4px',
          minHeight: '20px',
          color: allRequirementsMet ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-foreground)',
        }}>
          {password ? renderPasswordWithHighlighting() : (
            <span style={{ color: 'var(--vscode-input-placeholderForeground)' }}>
              Type your password...
            </span>
          )}
        </div>
      </div>

      {/* Length requirement indicator */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ 
          marginBottom: '8px', 
          color: 'var(--vscode-descriptionForeground)',
          fontSize: '0.85em'
        }}>
          Length: {password.length}/{minLength} characters
        </div>
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap',
          gap: '1px',
          alignItems: 'center'
        }}>
          {renderLengthIndicator()}
        </div>
      </div>

      {/* Email match warning */}
      {hasEmailMatch && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--vscode-errorForeground)',
          fontSize: '0.85em',
          marginBottom: '8px'
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
  );
};

// Updated password validation function
export const validateVisualPassword = (
  password: string, 
  email: string, 
  minLength: number = 15
): { isValid: boolean; issues: string[] } => {
  const issues: string[] = [];
  
  if (password.length < minLength) {
    issues.push(`Password must be at least ${minLength} characters long`);
  }
  
  if (email) {
    const emailUsername = email.split('@')[0].toLowerCase();
    if (emailUsername.length >= 3 && password.toLowerCase().includes(emailUsername)) {
      issues.push('Password should not contain parts of your email');
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}; 