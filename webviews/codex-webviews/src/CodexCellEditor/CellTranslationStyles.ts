import React, { CSSProperties } from 'react';

export type CellTranslationState = 'waiting' | 'processing' | 'completed' | 'fading' | null;

// Define keyframes for the pulseBorder animation
// Note: For actual animation, you would need to use a styled-components approach or similar
// This is a reference for what the animation should look like
const pulseBorderKeyframes = `
  0% {
    border-color: #ffc14d88;
    box-shadow: 0 0 3px rgba(255, 193, 77, 0.3);
  }
  50% {
    border-color: #ffc14d;
    box-shadow: 0 0 10px rgba(255, 193, 77, 0.6);
  }
  100% {
    border-color: #ffc14d88;
    box-shadow: 0 0 3px rgba(255, 193, 77, 0.3);
  }
`;

// Base styles for all translation states
const baseTranslationStyle: CSSProperties = {
  // Simpler border approach - less expensive than complex box-shadows
  border: '2px solid transparent',
  borderRadius: '4px',
  padding: '2px',
  position: 'relative',
  transition: 'border-color 0.3s ease', // Removed opacity transition to prevent fading
};

// Translation state-specific styles
export const translationStyles: Record<Exclude<CellTranslationState, null>, CSSProperties> = {
  waiting: {
    ...baseTranslationStyle,
    borderColor: '#ff6b6b', // Red
  },
  processing: {
    ...baseTranslationStyle,
    borderColor: '#ffc14d', // Yellow
  },
  completed: {
    ...baseTranslationStyle,
    borderColor: '#4caf50', // Green
  },
  fading: {
    ...baseTranslationStyle,
    borderColor: '#4caf50', // Green
    opacity: 0,
  },
};

// Special styles for inline mode
export const inlineTranslationStyles: Record<Exclude<CellTranslationState, null>, CSSProperties> = {
  waiting: {
    ...translationStyles.waiting,
    display: 'inline-block',
    margin: 0, // Remove margin to prevent movement
  },
  processing: {
    ...translationStyles.processing,
    display: 'inline-block',
    margin: 0, // Remove margin to prevent movement
  },
  completed: {
    ...translationStyles.completed,
    display: 'inline-block',
    margin: 0, // Remove margin to prevent movement
  },
  fading: {
    ...translationStyles.fading,
    display: 'inline-block',
    margin: 0, // Remove margin to prevent movement
  },
};

// Generate styles for empty cells in one-line-per-cell mode
export const getEmptyCellTranslationStyle = (
  translationState: CellTranslationState,
  allTranslationsComplete: boolean = false
): CSSProperties => {
  if (!translationState) {
    return {};
  }

  // Use same border colors as regular cells for consistency
  const borderColor =
    translationState === 'waiting' ? '#ff6b6b' :
      translationState === 'processing' ? '#ffc14d' :
        translationState === 'completed' ? '#4caf50' : 'transparent';

  // Use subtle background color with border - matching regular cell styling
  // DISABLED: opacity change to prevent cells from disappearing
  return {
    backgroundColor: 'transparent',
    border: `2px solid ${borderColor}`,
    borderRadius: '4px',
    transition: 'border-color 0.3s ease',
    opacity: 1, // Always keep cells visible
  };
};

// Function to get CSS class name for animation
export const getProcessingAnimationClassName = (useBackground: boolean = true): string => {
  return useBackground ? 'cell-translation-animation-processing-background' : 'cell-translation-animation-processing';
};

// Function to get the appropriate style based on translation state and display mode
export const getTranslationStyle = (
  translationState: CellTranslationState,
  isInlineMode: boolean,
  fadingOut: boolean = false
): CSSProperties & { className?: string; } => {
  if (!translationState) {
    return {};
  }

  // Handle fading out state
  if (fadingOut) {
    return isInlineMode ? inlineTranslationStyles.fading : translationStyles.fading;
  }

  const styles = isInlineMode ? inlineTranslationStyles : translationStyles;
  const result: CSSProperties & { className?: string; } = { ...styles[translationState] };

  // Add animation class name for processing state
  if (translationState === 'processing') {
    result.className = getProcessingAnimationClassName(true); // Use background animation
  }

  return result;
}; 