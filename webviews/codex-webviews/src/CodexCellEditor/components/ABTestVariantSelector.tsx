import React, { useState } from 'react';
import './ABTestVariantSelector.css';

interface ABTestVariantSelectorProps {
    variants: string[];
    cellId: string;
    testId: string;
    headerOverride?: string; // Custom header text (e.g., for recovery after attention check)
    onVariantSelected: (index: number, selectionTimeMs: number) => void;
    onDismiss: () => void;
}

export const ABTestVariantSelector: React.FC<ABTestVariantSelectorProps> = ({
    variants,
    cellId,
    testId,
    headerOverride,
    onVariantSelected,
    onDismiss
}) => {
    const [startTime] = useState(Date.now());
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [order] = useState<number[]>(() => variants.map((_, i) => i).sort(() => Math.random() - 0.5));

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
                    <h3>{headerOverride || (selectedIndex === null ? 'Choose Translation' : 'Result')}</h3>
                    {selectedIndex === null && !headerOverride ? (
                        <p>Pick the translation that reads best for this context.</p>
                    ) : selectedIndex !== null ? (
                        <p>Thanks! Your choice helps improve suggestions.</p>
                    ) : null}
                </div>
                
                <div className="ab-test-variants">
                    {order.map((idx, displayIndex) => (
                        <div
                            key={idx}
                            className={`ab-test-variant ${selectedIndex === idx ? 'selected' : ''}`}
                            onClick={() => handleVariantSelect(idx)}
                        >
                            <div className="variant-number">Option {displayIndex + 1}</div>
                            <div className="variant-content">
                                {stripHtmlTags(variants[idx])}
                            </div>
                            {selectedIndex === idx && (
                                <div className="variant-selected-indicator">✓ Selected</div>
                            )}
                        </div>
                    ))}
                </div>

                <div className="ab-test-footer">
                    {selectedIndex === null ? (
                        <span className="ab-test-help">Select the translation you prefer.</span>
                    ) : (
                        <button className="ab-test-apply" onClick={onDismiss}>
                            Apply
                        </button>
                    )}
                </div>

                {selectedIndex !== null && (
                    <div className="ab-test-applying">
                        <div>Applied.</div>
                    </div>
                )}
            </div>
        </div>
    );
};
