/**
 * Reference data from actual test files for comprehensive testing
 * This loads the real reference files as strings to avoid file system dependencies
 */

// TheChosen_101_en.source as string (first few cells for testing)
export const englishSourceReference = `{
  "cells": [
    {
      "kind": 2,
      "value": "<i>Abba?</i>",
      "languageId": "html",
      "metadata": {
        "type": "text",
        "id": "TheChosen-101-en 1:cue-50.634-51.468",
        "data": {
          "type": "text",
          "startTime": 50.634,
          "endTime": 51.468,
          "format": "VTT",
          "originalText": "<i>Abba?</i>"
        },
        "edits": []
      }
    },
    {
      "kind": 2,
      "value": "-You should be sleeping, little one.\\n-I can't sleep.",
      "languageId": "html",
      "metadata": {
        "type": "text",
        "id": "TheChosen-101-en 1:cue-54.012-56.348",
        "data": {
          "type": "text",
          "startTime": 54.012,
          "endTime": 56.348,
          "format": "VTT",
          "originalText": "-You should be sleeping, little one.\\n-I can't sleep."
        },
        "edits": []
      }
    },
    {
      "kind": 2,
      "value": "Sit down, sit down.",
      "languageId": "html",
      "metadata": {
        "type": "text",
        "id": "TheChosen-101-en 1:cue-56.431-58.308",
        "data": {
          "type": "text",
          "startTime": 56.431,
          "endTime": 58.308,
          "format": "VTT",
          "originalText": "Sit down, sit down."
        },
        "edits": []
      }
    }
  ]
}`;

// Parse reference data for testing
export const parseReferenceData = () => {
    try {
        const sourceData = JSON.parse(englishSourceReference);
        return {
            sourceCells: sourceData.cells,
            cellCount: sourceData.cells.length,
            firstCellId: sourceData.cells[0]?.metadata?.id,
            firstCellContent: sourceData.cells[0]?.value,
            firstCellStartTime: sourceData.cells[0]?.metadata?.data?.startTime,
            firstCellEndTime: sourceData.cells[0]?.metadata?.data?.endTime
        };
    } catch (error) {
        throw new Error(`Failed to parse reference data: ${error}`);
    }
};

// Expected alignment outcomes based on actual algorithm behavior
export const expectedAlignmentOutcomes = {
    // Should have paratext cells (early Tigrinya content before English starts)
    shouldHaveParatext: true,

    // Should have overlapping alignments (multiple Tigrinya to one English)
    shouldHaveOverlaps: true,

    // Minimum expected alignment count
    minAlignmentCount: 10,

    // Should preserve temporal ordering
    shouldPreserveTemporal: true,

    // All aligned cells should have timestamp alignment method
    expectedAlignmentMethod: 'timestamp' as const,

    // Should have confidence scores
    shouldHaveConfidence: true
};

/**
 * Compare actual alignment output with expected structure/behavior
 */
export const validateAlignmentOutput = (alignedCells: any[]) => {
    const issues: string[] = [];

    if (alignedCells.length < expectedAlignmentOutcomes.minAlignmentCount) {
        issues.push(`Expected at least ${expectedAlignmentOutcomes.minAlignmentCount} alignments, got ${alignedCells.length}`);
    }

    const paratextCells = alignedCells.filter(cell => cell.isParatext);
    if (expectedAlignmentOutcomes.shouldHaveParatext && paratextCells.length === 0) {
        issues.push('Expected paratext cells but found none');
    }

    const overlappingCells = alignedCells.filter(cell => cell.isAdditionalOverlap);
    if (expectedAlignmentOutcomes.shouldHaveOverlaps && overlappingCells.length === 0) {
        issues.push('Expected overlapping alignments but found none');
    }

    // Check temporal ordering
    if (expectedAlignmentOutcomes.shouldPreserveTemporal) {
        for (let i = 1; i < alignedCells.length; i++) {
            const prevStart = alignedCells[i - 1].importedContent?.startTime || 0;
            const currStart = alignedCells[i].importedContent?.startTime || 0;

            if (currStart < prevStart) {
                issues.push(`Temporal order violation at index ${i}: ${prevStart} -> ${currStart}`);
                break;
            }
        }
    }

    // Check alignment methods
    const wrongMethods = alignedCells.filter(cell =>
        cell.alignmentMethod !== expectedAlignmentOutcomes.expectedAlignmentMethod
    );
    if (wrongMethods.length > 0) {
        issues.push(`Expected all alignments to use '${expectedAlignmentOutcomes.expectedAlignmentMethod}' method, found ${wrongMethods.length} with different methods`);
    }

    // Check confidence scores
    if (expectedAlignmentOutcomes.shouldHaveConfidence) {
        const missingConfidence = alignedCells.filter(cell =>
            typeof cell.confidence !== 'number'
        );
        if (missingConfidence.length > 0) {
            issues.push(`Expected all alignments to have confidence scores, found ${missingConfidence.length} without`);
        }
    }

    return {
        isValid: issues.length === 0,
        issues,
        summary: {
            totalAlignments: alignedCells.length,
            paratextCount: paratextCells.length,
            overlapCount: overlappingCells.length,
            mainAlignments: alignedCells.filter(cell => !cell.isParatext && !cell.isAdditionalOverlap).length
        }
    };
}; 