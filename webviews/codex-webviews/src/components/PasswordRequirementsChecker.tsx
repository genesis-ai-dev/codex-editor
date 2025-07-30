import React from 'react';

export interface PasswordRequirement {
  id: string;
  label: string;
  validator: (password: string) => boolean;
  description?: string;
}

interface PasswordRequirementsCheckerProps {
  password: string;
  requirements: PasswordRequirement[];
  showRequirements?: boolean;
}

export const PasswordRequirementsChecker: React.FC<PasswordRequirementsCheckerProps> = ({
  password,
  requirements,
  showRequirements = true,
}) => {
  if (!showRequirements) {
    return null;
  }

  const allRequirementsMet = requirements.every(req => req.validator(password));

  return (
    <div style={{ marginTop: '8px', fontSize: '0.9em' }}>
      <div style={{ 
        marginBottom: '8px', 
        color: allRequirementsMet ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-descriptionForeground)',
        fontWeight: allRequirementsMet ? 'bold' : 'normal'
      }}>
        Password Requirements:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {requirements.map((requirement) => {
          const isMet = requirement.validator(password);
          return (
            <div
              key={requirement.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: isMet ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-descriptionForeground)',
              }}
            >
              <span
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12px',
                  backgroundColor: isMet ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-textBlockQuote-background)',
                  color: isMet ? 'var(--vscode-editor-background)' : 'var(--vscode-descriptionForeground)',
                  border: isMet ? 'none' : '1px solid var(--vscode-descriptionForeground)',
                }}
              >
                {isMet ? '✓' : ''}
              </span>
              <span style={{ fontSize: '0.85em' }}>
                {requirement.label}
                {requirement.description && (
                  <span style={{ 
                    color: 'var(--vscode-descriptionForeground)', 
                    fontSize: '0.9em',
                    marginLeft: '4px' 
                  }}>
                    {requirement.description}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      
      {/* Overall strength indicator */}
      <div style={{ marginTop: '12px' }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '4px'
        }}>
          <span style={{ fontSize: '0.8em', color: 'var(--vscode-descriptionForeground)' }}>
            Password Strength
          </span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.75em',
              fontWeight: 'bold',
              backgroundColor: allRequirementsMet 
                ? 'var(--vscode-testing-iconPassed)' 
                : password.length > 0 
                  ? 'var(--vscode-problemsWarningIcon-foreground)' 
                  : 'var(--vscode-textBlockQuote-background)',
              color: allRequirementsMet || password.length > 0
                ? 'var(--vscode-editor-background)'
                : 'var(--vscode-descriptionForeground)',
            }}
          >
            {allRequirementsMet ? "Strong" : password.length > 0 ? "Weak" : "Empty"}
          </span>
        </div>
        <div
          style={{
            height: '4px',
            background: 'var(--vscode-textBlockQuote-background)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min((requirements.filter(req => req.validator(password)).length / requirements.length) * 100, 100)}%`,
              height: '100%',
              background: allRequirementsMet 
                ? 'var(--vscode-testing-iconPassed)' 
                : password.length > 0 
                  ? 'var(--vscode-problemsWarningIcon-foreground)' 
                  : 'var(--vscode-textBlockQuote-background)',
              transition: 'width 0.3s ease-in-out',
            }}
          />
        </div>
      </div>
    </div>
  );
};

// Standard GitLab-like password requirements
export const createStandardPasswordRequirements = (): PasswordRequirement[] => [
  {
    id: 'length',
    label: 'At least 15 characters',
    validator: (password: string) => password.length >= 15,
  },
  {
    id: 'uppercase',
    label: 'At least one uppercase letter',
    validator: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: 'lowercase',
    label: 'At least one lowercase letter',
    validator: (password: string) => /[a-z]/.test(password),
  },
];

// Utility function to validate password against requirements
export const validatePasswordRequirements = (
  password: string, 
  requirements: PasswordRequirement[]
): { isValid: boolean; unmetRequirements: string[] } => {
  const unmetRequirements = requirements
    .filter(req => !req.validator(password))
    .map(req => req.label);
  
  return {
    isValid: unmetRequirements.length === 0,
    unmetRequirements,
  };
}; 