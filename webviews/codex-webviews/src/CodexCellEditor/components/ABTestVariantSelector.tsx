import React, { useState, useMemo } from 'react';
import './ABTestVariantSelector.css';
import { getVSCodeAPI } from '../../shared/vscodeApi';

interface ABTestVariantSelectorProps {
    variants: string[];
    cellId: string;
    testId: string;
    names?: string[];
    abProbability?: number;
    onVariantSelected: (index: number, selectionTimeMs: number) => void;
    onDismiss: () => void;
}

export const ABTestVariantSelector: React.FC<ABTestVariantSelectorProps> = ({
    variants,
    cellId,
    testId,
    names,
    abProbability,
    onVariantSelected,
    onDismiss
}) => {
    const [startTime] = useState(Date.now());
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [order, setOrder] = useState<number[]>(() => variants.map((_, i) => i).sort(() => Math.random() - 0.5));

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

    const [prob, setProb] = useState<number>(typeof abProbability === 'number' ? abProbability : NaN);
    const [adjustmentFeedback, setAdjustmentFeedback] = useState<null | 'more' | 'less'>(null);
    const vscode = useMemo(() => getVSCodeAPI(), []);

    const adjustProbability = (delta: number, kind: 'more' | 'less') => {
        vscode?.postMessage({
            command: 'adjustABTestingProbability',
            content: { 
                delta,
                buttonChoice: kind,
                testId,
                cellId
            }
        });
        setAdjustmentFeedback(kind);
    };

    // Listen for updates so future designs can reflect the new value (hidden in UI)
    React.useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg = event.data;
            if (msg?.type === 'abTestingProbabilityUpdated' && typeof msg.content?.value === 'number') {
                setProb(msg.content.value);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    return (
        <div className="ab-test-overlay" onClick={onDismiss}>
            <div className="ab-test-modal" onClick={(e) => e.stopPropagation()}>
                <div className="ab-test-header">
                    <h3>{selectedIndex === null ? 'Choose Translation' : 'Result'}</h3>
                    {selectedIndex === null ? (
                        <p>Pick the translation that reads best for this context.</p>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                        {selectedIndex === null ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                                <span className="ab-test-help">Select the translation you prefer.</span>
                            </div>
                        ) : (
                            <>
                                <div className="ab-prob-controls" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {adjustmentFeedback === null ? (
                                        <>
                                            <button className="ab-test-apply" onClick={() => adjustProbability(-0.1, 'less')} title="Prefer fewer A/B tests">See less</button>
                                            <button className="ab-test-apply" onClick={() => adjustProbability(+0.1, 'more')} title="Prefer more A/B tests">See more</button>
                                        </>
                                    ) : (
                                        <span style={{ opacity: 0.85 }}>
                                            Preference recorded.
                                        </span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                                    <button className="ab-test-apply" onClick={onDismiss}>
                                        Apply
                                    </button>
                                </div>
                            </>
                        )}
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
