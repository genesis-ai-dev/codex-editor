import React, { useState, useEffect } from 'react';
import './ABTestVariantSelector.css';

interface ABTestVariantSelectorProps {
    variants: string[];
    cellId: string;
    testId: string;
    onVariantSelected: (index: number, selectionTimeMs: number) => void;
    onDismiss: () => void;
}

export const ABTestVariantSelector: React.FC<ABTestVariantSelectorProps> = ({
    variants,
    cellId,
    testId,
    onVariantSelected,
    onDismiss
}) => {
    const [startTime] = useState(Date.now());
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    // Auto-dismiss after 30 seconds if no selection made
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (selectedIndex === null) {
                handleVariantSelect(0); // Default to first variant
            }
        }, 30000);

        return () => clearTimeout(timeout);
    }, [selectedIndex]);

    const handleVariantSelect = (index: number) => {
        if (selectedIndex !== null) return; // Prevent double selection

        const selectionTime = Date.now() - startTime;
        setSelectedIndex(index);
        onVariantSelected(index, selectionTime);
    };

    const stripHtmlTags = (html: string): string => {
        return html.replace(/<[^>]*>/g, '').trim();
    };

    if (variants.length <= 1) {
        return null;
    }

    return (
        <div className="ab-test-overlay" onClick={onDismiss}>
            <div className="ab-test-modal" onClick={(e) => e.stopPropagation()}>
                <div className="ab-test-header">
                    <h3>Choose Translation</h3>
                    <p>Select the translation that sounds most natural:</p>
                </div>
                
                <div className="ab-test-variants">
                    {variants.map((variant, index) => (
                        <div
                            key={index}
                            className={`ab-test-variant ${selectedIndex === index ? 'selected' : ''}`}
                            onClick={() => handleVariantSelect(index)}
                        >
                            <div className="variant-number">Option {index + 1}</div>
                            <div className="variant-content">
                                {stripHtmlTags(variant)}
                            </div>
                            {selectedIndex === index && (
                                <div className="variant-selected-indicator">✓ Selected</div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="ab-test-footer">
                    <button 
                        className="ab-test-cancel"
                        onClick={onDismiss}
                        disabled={selectedIndex !== null}
                    >
                        Cancel
                    </button>
                    <span className="ab-test-help">
                        Click on your preferred translation or it will auto-select in 30s
                    </span>
                </div>

                {selectedIndex !== null && (
                    <div className="ab-test-applying">
                        Applying selected translation...
                    </div>
                )}
            </div>
        </div>
    );
};


