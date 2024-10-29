interface ValidationResultProps {
    result: {
        isValid: boolean;
        errors: Array<{ message: string }>;
    };
}

const ValidationResult: React.FC<ValidationResultProps> = ({ result }) => {
    if (result.isValid) {
        return (
            <div
                style={{
                    padding: "0.5rem 1rem",
                    marginTop: "1rem",
                    background: "var(--vscode-testing-iconPassed)15",
                    border: "1px solid var(--vscode-testing-iconPassed)",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                }}
            >
                <i className="codicon codicon-check" />
                <span>Content validation passed</span>
            </div>
        );
    }

    return (
        <div
            style={{
                padding: "0.5rem 1rem",
                marginTop: "1rem",
                background: "var(--vscode-inputValidation-errorBackground)",
                border: "1px solid var(--vscode-inputValidation-errorBorder)",
                borderRadius: "4px",
            }}
        >
            {result.errors.map((error, index) => (
                <div
                    key={index}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        color: "var(--vscode-inputValidation-errorForeground)",
                    }}
                >
                    <i className="codicon codicon-error" />
                    <span>{error.message}</span>
                </div>
            ))}
        </div>
    );
};

export default ValidationResult;
