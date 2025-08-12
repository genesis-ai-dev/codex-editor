import React, { useState, useEffect } from 'react';
import './ABTestVariantSelector.css';

interface ABTestVariantSelectorProps {
    variants: string[];
    cellId: string;
    testId: string;
    names?: string[];
    onVariantSelected: (index: number, selectionTimeMs: number) => void;
    onDismiss: () => void;
}

export const ABTestVariantSelector: React.FC<ABTestVariantSelectorProps> = ({
    variants,
    cellId,
    testId,
    names,
    onVariantSelected,
    onDismiss
}) => {
    const [startTime] = useState(Date.now());
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [order, setOrder] = useState<number[]>(() => variants.map((_, i) => i).sort(() => Math.random() - 0.5));

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
                    <h3>{selectedIndex === null ? 'Choose Translation' : 'Result'}</h3>
                    {selectedIndex === null ? (
                        <p>Select the translation that sounds most natural:</p>
                    ) : (
                        names && names.length === variants.length ? (
                            <p>Tested: {names.join(' vs ')}</p>
                        ) : null
                    )}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                        {selectedIndex === null && (
                            <span className="ab-test-help">
                                Click your preferred translation or it will auto-select in 30s
                            </span>
                        )}
                        <button className="ab-test-apply" onClick={onDismiss} disabled={selectedIndex === null}>
                            Close
                        </button>
                    </div>
                </div>

                {selectedIndex !== null && (
                    <div className="ab-test-applying">
                        <div>Applied. {names && names.length === variants.length ? (
                            <>Tested: {names.join(" vs ")}</>
                        ) : null}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};


