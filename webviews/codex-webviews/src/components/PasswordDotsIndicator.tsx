import React from 'react';

interface PasswordDotsIndicatorProps {
  password: string;
  email: string;
  username: string;
  minLength?: number;
  showIndicator?: boolean;
}

export const PasswordDotsIndicator: React.FC<PasswordDotsIndicatorProps> = ({
  password,
  email,
  username,
  minLength = 15,
  showIndicator = true,
}) => {
  if (!showIndicator) {
    return null;
  }

  // Enhanced matching - checks for any 3+ character substring from email or username
  const getProblematicMatches = (): { start: number; end: number }[] => {
    if (!password || password.length < 3) return [];
    
    const matches: { start: number; end: number }[] = [];
    const lowerPassword = password.toLowerCase();
    const sourcesToCheck = [];
    
    // Add email to sources if provided
    if (email) {
      sourcesToCheck.push(email.toLowerCase());
    }
    
    // Add username to sources if provided
    if (username) {
      sourcesToCheck.push(username.toLowerCase());
    }
    
    // Check for any 3+ character substring from each source
    sourcesToCheck.forEach(source => {
      for (let sourceStart = 0; sourceStart <= source.length - 3; sourceStart++) {
        for (let sourceEnd = sourceStart + 3; sourceEnd <= source.length; sourceEnd++) {
          const sourceSubstring = source.substring(sourceStart, sourceEnd);
          
          // Skip common short words and symbols that might cause false positives
          if (sourceSubstring.includes('@') || sourceSubstring.includes('.') || 
              ['com', 'org', 'net', 'edu', 'gov'].includes(sourceSubstring)) {
            continue;
          }
          
          // Look for this substring in the password
          for (let passStart = 0; passStart <= lowerPassword.length - sourceSubstring.length; passStart++) {
            if (lowerPassword.substring(passStart, passStart + sourceSubstring.length) === sourceSubstring) {
              matches.push({ start: passStart, end: passStart + sourceSubstring.length });
            }
          }
        }
      }
    });
    
    // Remove overlapping matches, keeping the longest ones
    return matches.sort((a, b) => (b.end - b.start) - (a.end - a.start))
      .filter((match, index, arr) => {
        return !arr.slice(0, index).some(prev => 
          (match.start >= prev.start && match.start < prev.end) ||
          (match.end > prev.start && match.end <= prev.end)
        );
      });
  };

  const problematicMatches = getProblematicMatches();
  const hasProblematicMatch = problematicMatches.length > 0;
  const isLengthValid = password.length >= minLength;
  const allRequirementsMet = isLengthValid && !hasProblematicMatch;

  // Render the dots and letters
  const renderDots = () => {
    const elements = [];
    const currentLength = password.length;
    
    // Create elements for entered characters
    for (let i = 0; i < currentLength; i++) {
      const isInProblematicMatch = problematicMatches.some(match => i >= match.start && i < match.end);
      const char = password[i];
      
      if (isInProblematicMatch) {
        // Show actual letter for email/username matches
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
        
        {/* Email/username match warning */}
        {hasProblematicMatch && (
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
            Password should not contain parts of your email or username
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

// Enhanced password validation function
export const validateVisualPassword = (
  password: string, 
  email: string, 
  username: string, 
  minLength: number = 15
): { isValid: boolean; issues: string[] } => {
  const issues: string[] = [];
  
  if (password.length < minLength) {
    issues.push(`Password must be at least ${minLength} characters long`);
  }
  
  if (password.length >= 3) {
    const lowerPassword = password.toLowerCase();
    const sourcesToCheck = [];
    
    // Add sources to check
    if (email) sourcesToCheck.push(email.toLowerCase());
    if (username) sourcesToCheck.push(username.toLowerCase());
    
    // Check for any 3+ character substring from email or username
    let hasMatch = false;
    sourcesToCheck.forEach(source => {
      if (hasMatch) return; // Already found a match
      
      for (let sourceStart = 0; sourceStart <= source.length - 3 && !hasMatch; sourceStart++) {
        for (let sourceEnd = sourceStart + 3; sourceEnd <= source.length; sourceEnd++) {
          const sourceSubstring = source.substring(sourceStart, sourceEnd);
          
          // Skip common short words and symbols
          if (sourceSubstring.includes('@') || sourceSubstring.includes('.') || 
              ['com', 'org', 'net', 'edu', 'gov'].includes(sourceSubstring)) {
            continue;
          }
          
          if (lowerPassword.includes(sourceSubstring)) {
            hasMatch = true;
            break;
          }
        }
      }
    });
    
    if (hasMatch) {
      issues.push('Password should not contain parts of your email or username');
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}; 