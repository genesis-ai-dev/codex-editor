import React from 'react';

interface PasswordDotsIndicatorProps {
  password: string;
  email: string;
  minLength?: number;
  showIndicator?: boolean;
}

export const PasswordDotsIndicator: React.FC<PasswordDotsIndicatorProps> = ({
  password,
  email,
  minLength = 15,
  showIndicator = true,
}) => {
  if (!showIndicator) {
    return null;
  }

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

  // Render the dots and letters
  const renderDots = () => {
    const elements = [];
    const currentLength = password.length;
    
    // Create elements for entered characters
    for (let i = 0; i < currentLength; i++) {
      const isInEmailMatch = emailMatches.some(match => i >= match.start && i < match.end);
      const char = password[i];
      
      if (isInEmailMatch) {
        // Show actual letter for email matches
        elements.push(
          <span
            key={`letter-${i}`}
            style={{
              display: 'inline-block',
              width: '10px',
              height: '10px',
              fontSize: '10px',
              fontWeight: 'bold',
              color: 'var(--vscode-editor-background)',
              backgroundColor: 'var(--vscode-errorForeground)',
              borderRadius: '2px',
              margin: '0 2px 0 0',
              textAlign: 'center',
              lineHeight: '10px',
              fontFamily: 'monospace',
            }}
          >
            {char}
          </span>
        );
      } else {
        // Show green dot for regular characters
        elements.push(
          <span
            key={`dot-${i}`}
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: allRequirementsMet ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-testing-iconPassed)',
              margin: '0 2px 0 0',
            }}
          />
        );
      }
    }
    
    // Create dots for remaining characters needed
    for (let i = currentLength; i < minLength; i++) {
      elements.push(
        <span
          key={`empty-${i}`}
          style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--vscode-errorForeground)',
            opacity: 0.3,
            margin: '0 2px 0 0',
          }}
        />
      );
    }
    
    return elements;
  };

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Dots indicator */}
      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '1px',
        marginBottom: '8px'
      }}>
        {renderDots()}
      </div>

      {/* Status text below dots */}
      <div style={{ fontSize: '0.85em' }}>
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

// Keep the enhanced password validation function
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