import { useEffect, useRef, useState } from "react";

interface AdaptiveProjectTitleProps {
    title: string;
    className?: string;
    style?: React.CSSProperties;
    minFontSize?: number;
    maxFontSize?: number;
}

/**
 * Component that displays a project title with:
 * 1. Line breaks only when necessary (if title doesn't fit on one line)
 * 2. Line breaks at underscores, dashes, and spaces (keeping dashes/underscores in text)
 * 3. Dynamic font size adjustment if any line is still too long after breaking
 */
export const AdaptiveProjectTitle: React.FC<AdaptiveProjectTitleProps> = ({
    title,
    className = "",
    style = {},
    minFontSize,
    maxFontSize = 18,
}) => {
    const textRef = useRef<HTMLDivElement>(null);
    const [fontSize, setFontSize] = useState(maxFontSize);
    const [lines, setLines] = useState<string[]>(title ? [title] : []);

    // Measure text and adjust font size, and determine if line breaks are needed
    useEffect(() => {
        if (!textRef.current || !title) {
            return;
        }

        const measureAndAdjust = () => {
            const textElement = textRef.current;
            if (!textElement) return;

            // Find the immediate parent container (the flex container with icon and this text)
            const parent = textElement.parentElement;
            if (!parent) return;

            const parentRect = parent.getBoundingClientRect();
            const parentWidth = parentRect.width;

            // Get the icon element to measure its actual width
            const icon = parent.querySelector(".codicon");
            const iconWidth = icon ? icon.getBoundingClientRect().width : 20;

            // Account for icon width and gap (gap-2 = 8px)
            const gap = 8;
            const availableWidth = parentWidth - iconWidth - gap;

            if (availableWidth <= 0) return;

            // Default minFontSize to half of maxFontSize
            const effectiveMinFontSize = minFontSize ?? maxFontSize / 2;

            // Create a temporary element to measure text width
            const tempElement = document.createElement("span");
            tempElement.style.visibility = "hidden";
            tempElement.style.position = "absolute";
            tempElement.style.whiteSpace = "nowrap";
            tempElement.style.fontWeight = window.getComputedStyle(textElement).fontWeight;
            tempElement.style.fontFamily = window.getComputedStyle(textElement).fontFamily;
            tempElement.style.letterSpacing = window.getComputedStyle(textElement).letterSpacing;
            document.body.appendChild(tempElement);

            // Helper function to measure text width at a given font size
            const measureWidth = (text: string, fontSize: number): number => {
                tempElement.style.fontSize = `${fontSize}px`;
                tempElement.textContent = text;
                return tempElement.getBoundingClientRect().width;
            };

            // Helper function to break text into lines - breaks when line is too long
            // Prefers breaking at spaces, dashes, underscores. If none available, breaks in middle of word.
            const breakIntoLines = (text: string, fontSize: number): string[] => {
                const lines: string[] = [];
                let i = 0;

                while (i < text.length) {
                    let currentLine = "";
                    let lastGoodBreakIndex = -1; // Position in currentLine where we could break
                    let lastGoodBreakTextIndex = -1; // Position in TEXT where we could break
                    let lastGoodBreakChar = "";
                    
                    // Build up the current line character by character
                    while (i < text.length) {
                        const char = text[i];
                        const testLine = currentLine + char;
                        const testWidth = measureWidth(testLine, fontSize);
                        
                        // Check if this is a good break point
                        if (char === " " || char === "-" || char === "_") {
                            lastGoodBreakIndex = currentLine.length;
                            lastGoodBreakTextIndex = i; // Track position in TEXT
                            lastGoodBreakChar = char;
                        }
                        
                        // If line fits, add the character
                        if (testWidth <= availableWidth) {
                            currentLine = testLine;
                            i++;
                        } else {
                            // Line is too long - need to break
                            if (lastGoodBreakIndex >= 0) {
                                // We have a good break point - break there
                                const breakPoint = lastGoodBreakIndex;
                                let lineToAdd = currentLine.substring(0, breakPoint);
                                
                                // For dashes and underscores, include the separator at end of line
                                if (lastGoodBreakChar === "-" || lastGoodBreakChar === "_") {
                                    lineToAdd += lastGoodBreakChar;
                                }
                                
                                lines.push(lineToAdd);
                                // Continue from after the separator in the TEXT
                                i = lastGoodBreakTextIndex + 1;
                            } else {
                                // No good break point - break in the middle of the word
                                // Take at least one character
                                if (currentLine.length > 0) {
                                    lines.push(currentLine);
                                } else {
                                    // Even one character doesn't fit - add it anyway
                                    lines.push(char);
                                    i++;
                                }
                            }
                            break; // Move to next line
                        }
                    }
                    
                    // If we've processed all text, add the remaining line
                    if (i >= text.length && currentLine.length > 0) {
                        lines.push(currentLine);
                        break;
                    }
                }

                return lines.length > 0 ? lines : [text];
            };

            // First, check if the full title fits on one line at max font size
            const fullTitleWidth = measureWidth(title, maxFontSize);

            let finalLines: string[] = [];
            let finalFontSize = maxFontSize;

            if (fullTitleWidth <= availableWidth) {
                // Title fits on one line - no breaks needed
                finalLines = [title];
                finalFontSize = maxFontSize;
            } else {
                // Title doesn't fit - need to break intelligently
                // Try to find the optimal font size and line breaks
                // If we need 3+ lines, shrink font size instead of adding more lines
                let currentFontSize = maxFontSize;
                let bestLines: string[] = [];
                let foundFit = false;

                while (currentFontSize >= effectiveMinFontSize) {
                    // Always try to break into lines
                    const testLines = breakIntoLines(title, currentFontSize);
                    
                    // If we need 3 or more lines, reduce font size and try again
                    if (testLines.length > 3) { //could be >=
                        currentFontSize -= 0.5;
                        continue;
                    }
                    
                    // We have 1-2 lines, check if they all fit
                    let allLinesFit = true;

                    for (const line of testLines) {
                        const lineWidth = measureWidth(line, currentFontSize);
                        if (lineWidth > availableWidth) {
                            allLinesFit = false;
                            break;
                        }
                    }

                    if (allLinesFit) {
                        bestLines = testLines;
                        finalFontSize = currentFontSize;
                        foundFit = true;
                        break;
                    }

                    // Lines don't fit - reduce font size and try again
                    currentFontSize -= 0.5;
                }

                if (!foundFit) {
                    // Even at minimum font size, try to get the best result
                    // Try one more time at minimum size
                    const minSizeLines = breakIntoLines(title, effectiveMinFontSize);
                    // Check if all lines fit
                    let allMinLinesFit = true;
                    for (const line of minSizeLines) {
                        const lineWidth = measureWidth(line, effectiveMinFontSize);
                        if (lineWidth > availableWidth) {
                            allMinLinesFit = false;
                            break;
                        }
                    }
                    
                    // Use the result even if some lines don't fit perfectly (they'll be slightly over)
                    finalLines = minSizeLines;
                    finalFontSize = effectiveMinFontSize;
                } else {
                    finalLines = bestLines;
                }
            }

            document.body.removeChild(tempElement);

            setLines(finalLines);
            setFontSize(finalFontSize);
        };

        // Measure after a short delay to ensure DOM is ready
        const timeoutId = setTimeout(measureAndAdjust, 0);

        // Also measure on resize
        window.addEventListener("resize", measureAndAdjust);

        // Use ResizeObserver to watch for container size changes
        const resizeObserver = new ResizeObserver(measureAndAdjust);
        if (textRef.current?.parentElement) {
            resizeObserver.observe(textRef.current.parentElement);
        }

        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener("resize", measureAndAdjust);
            resizeObserver.disconnect();
        };
    }, [title, minFontSize, maxFontSize]);

    if (lines.length === 0) {
        return null;
    }

    return (
        <div
            ref={textRef}
            className={className}
            style={{
                fontSize: `${fontSize}px`,
                lineHeight: "1.4",
                wordBreak: "break-word",
                overflowWrap: "break-word",
                ...style,
            }}
        >
            {lines.map((line, index) => (
                <span key={index}>
                    {line}
                    {index < lines.length - 1 && <br />}
                </span>
            ))}
        </div>
    );
};
