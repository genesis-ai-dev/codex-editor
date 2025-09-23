/**
 * Round-trip validator for InDesign files
 * Ensures loss-free editing by comparing original and reconstructed files
 */

import {
    IDMLDocument,
    RoundTripValidationResult,
    RoundTripDifference,
    IDMLValidationError
} from '../types';
import { compareIDMLStructures, computeSHA256 } from './hashUtils';

export class RoundTripValidator {
    /**
     * Validate round-trip integrity of IDML document
     */
    async validateRoundTrip(
        originalIDML: string,
        reconstructedIDML: string,
        originalDocument?: IDMLDocument
    ): Promise<RoundTripValidationResult> {
        const validation: RoundTripValidationResult = {
            isLossFree: true,
            originalHash: await computeSHA256(originalIDML),
            reconstructedHash: await computeSHA256(reconstructedIDML),
            differences: [],
            warnings: [],
            errors: [],
            validationTimestamp: new Date().toISOString()
        };

        try {
            // Compare file structures
            const structureComparison = await compareIDMLStructures(originalIDML, reconstructedIDML);

            if (!structureComparison.contentMatch) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'content',
                    location: 'Document content',
                    original: 'Original content hash',
                    reconstructed: 'Reconstructed content hash',
                    severity: 'high'
                });
            }

            if (!structureComparison.structuralMatch) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: 'Document structure',
                    original: 'Original structural hash',
                    reconstructed: 'Reconstructed structural hash',
                    severity: 'high'
                });
            }

            // Validate specific elements if document is provided
            if (originalDocument) {
                await this.validateDocumentElements(originalDocument, reconstructedIDML, validation);
            }

            // Check for common issues
            this.checkForCommonIssues(originalIDML, reconstructedIDML, validation);

        } catch (error) {
            validation.isLossFree = false;
            validation.errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        return validation;
    }

    /**
     * Validate specific document elements
     */
    private async validateDocumentElements(
        originalDocument: IDMLDocument,
        reconstructedIDML: string,
        validation: RoundTripValidationResult
    ): Promise<void> {
        // Validate stories
        await this.validateStories(originalDocument.stories, reconstructedIDML, validation);

        // Validate styles
        await this.validateStyles(originalDocument.styles, reconstructedIDML, validation);

        // Validate resources
        await this.validateResources(originalDocument.resources, reconstructedIDML, validation);

        // Validate metadata
        await this.validateMetadata(originalDocument.metadata, reconstructedIDML, validation);
    }

    /**
     * Validate stories preservation
     */
    private async validateStories(
        originalStories: any[],
        reconstructedIDML: string,
        validation: RoundTripValidationResult
    ): Promise<void> {
        for (const story of originalStories) {
            // Check if story ID is preserved
            if (!reconstructedIDML.includes(`id="${story.id}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: `Story ${story.id}`,
                    original: `Story with ID ${story.id}`,
                    reconstructed: 'Story ID not found',
                    severity: 'critical'
                });
            }

            // Check if story name is preserved
            if (story.name && !reconstructedIDML.includes(`name="${story.name}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'metadata',
                    location: `Story ${story.id} name`,
                    original: story.name,
                    reconstructed: 'Story name not found',
                    severity: 'medium'
                });
            }

            // Validate paragraphs
            await this.validateParagraphs(story.paragraphs, reconstructedIDML, validation, story.id);
        }
    }

    /**
     * Validate paragraphs preservation
     */
    private async validateParagraphs(
        originalParagraphs: any[],
        reconstructedIDML: string,
        validation: RoundTripValidationResult,
        storyId: string
    ): Promise<void> {
        for (const paragraph of originalParagraphs) {
            // Check if paragraph ID is preserved
            if (!reconstructedIDML.includes(`id="${paragraph.id}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: `Paragraph ${paragraph.id} in Story ${storyId}`,
                    original: `Paragraph with ID ${paragraph.id}`,
                    reconstructed: 'Paragraph ID not found',
                    severity: 'critical'
                });
            }

            // Check if paragraph style is preserved
            const styleRef = paragraph.paragraphStyleRange.appliedParagraphStyle;
            if (!reconstructedIDML.includes(`appliedParagraphStyle="${styleRef}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'formatting',
                    location: `Paragraph ${paragraph.id} style`,
                    original: styleRef,
                    reconstructed: 'Paragraph style not found',
                    severity: 'high'
                });
            }

            // Validate character style ranges
            await this.validateCharacterRanges(
                paragraph.characterStyleRanges,
                reconstructedIDML,
                validation,
                paragraph.id
            );
        }
    }

    /**
     * Validate character style ranges preservation
     */
    private async validateCharacterRanges(
        originalCharacterRanges: any[],
        reconstructedIDML: string,
        validation: RoundTripValidationResult,
        paragraphId: string
    ): Promise<void> {
        for (const charRange of originalCharacterRanges) {
            // Check if character range ID is preserved
            if (!reconstructedIDML.includes(`id="${charRange.id}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: `Character range ${charRange.id} in Paragraph ${paragraphId}`,
                    original: `Character range with ID ${charRange.id}`,
                    reconstructed: 'Character range ID not found',
                    severity: 'critical'
                });
            }

            // Check if character style is preserved
            const styleRef = charRange.appliedCharacterStyle;
            if (!reconstructedIDML.includes(`appliedCharacterStyle="${styleRef}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'formatting',
                    location: `Character range ${charRange.id} style`,
                    original: styleRef,
                    reconstructed: 'Character style not found',
                    severity: 'high'
                });
            }

            // Check if content is preserved
            if (!reconstructedIDML.includes(charRange.content)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'content',
                    location: `Character range ${charRange.id} content`,
                    original: charRange.content,
                    reconstructed: 'Content not found',
                    severity: 'critical'
                });
            }
        }
    }

    /**
     * Validate styles preservation
     */
    private async validateStyles(
        originalStyles: any,
        reconstructedIDML: string,
        validation: RoundTripValidationResult
    ): Promise<void> {
        // Validate paragraph styles
        for (const style of originalStyles.paragraphStyles) {
            if (!reconstructedIDML.includes(`id="${style.id}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: `Paragraph style ${style.id}`,
                    original: `Paragraph style with ID ${style.id}`,
                    reconstructed: 'Paragraph style ID not found',
                    severity: 'high'
                });
            }
        }

        // Validate character styles
        for (const style of originalStyles.characterStyles) {
            if (!reconstructedIDML.includes(`id="${style.id}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: `Character style ${style.id}`,
                    original: `Character style with ID ${style.id}`,
                    reconstructed: 'Character style ID not found',
                    severity: 'high'
                });
            }
        }
    }

    /**
     * Validate resources preservation
     */
    private async validateResources(
        originalResources: any,
        reconstructedIDML: string,
        validation: RoundTripValidationResult
    ): Promise<void> {
        // Validate fonts
        for (const font of originalResources.fonts) {
            if (!reconstructedIDML.includes(`id="${font.id}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: `Font ${font.id}`,
                    original: `Font with ID ${font.id}`,
                    reconstructed: 'Font ID not found',
                    severity: 'medium'
                });
            }
        }

        // Validate colors
        for (const color of originalResources.colors) {
            if (!reconstructedIDML.includes(`id="${color.id}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: `Color ${color.id}`,
                    original: `Color with ID ${color.id}`,
                    reconstructed: 'Color ID not found',
                    severity: 'medium'
                });
            }
        }

        // Validate images
        for (const image of originalResources.images) {
            if (!reconstructedIDML.includes(`id="${image.id}"`)) {
                validation.isLossFree = false;
                validation.differences.push({
                    type: 'structure',
                    location: `Image ${image.id}`,
                    original: `Image with ID ${image.id}`,
                    reconstructed: 'Image ID not found',
                    severity: 'medium'
                });
            }
        }
    }

    /**
     * Validate metadata preservation
     */
    private async validateMetadata(
        originalMetadata: any,
        reconstructedIDML: string,
        validation: RoundTripValidationResult
    ): Promise<void> {
        if (originalMetadata.title && !reconstructedIDML.includes(`<title>${originalMetadata.title}</title>`)) {
            validation.isLossFree = false;
            validation.differences.push({
                type: 'metadata',
                location: 'Document title',
                original: originalMetadata.title,
                reconstructed: 'Title not found',
                severity: 'low'
            });
        }

        if (originalMetadata.author && !reconstructedIDML.includes(`<author>${originalMetadata.author}</author>`)) {
            validation.isLossFree = false;
            validation.differences.push({
                type: 'metadata',
                location: 'Document author',
                original: originalMetadata.author,
                reconstructed: 'Author not found',
                severity: 'low'
            });
        }
    }

    /**
     * Check for common issues in round-trip
     */
    private checkForCommonIssues(
        originalIDML: string,
        reconstructedIDML: string,
        validation: RoundTripValidationResult
    ): void {
        // Check for XML declaration preservation
        if (originalIDML.includes('<?xml') && !reconstructedIDML.includes('<?xml')) {
            validation.warnings.push('XML declaration missing in reconstructed file');
        }

        // Check for namespace preservation
        if (originalIDML.includes('xmlns:idPkg') && !reconstructedIDML.includes('xmlns:idPkg')) {
            validation.warnings.push('IDML namespace missing in reconstructed file');
        }

        // Check for encoding preservation
        if (originalIDML.includes('encoding="UTF-8"') && !reconstructedIDML.includes('encoding="UTF-8"')) {
            validation.warnings.push('UTF-8 encoding declaration missing in reconstructed file');
        }

        // Check for empty elements
        const originalEmptyElements = (originalIDML.match(/<[^>]*\/>/g) || []).length;
        const reconstructedEmptyElements = (reconstructedIDML.match(/<[^>]*\/>/g) || []).length;

        if (originalEmptyElements !== reconstructedEmptyElements) {
            validation.warnings.push(`Empty element count mismatch: original ${originalEmptyElements}, reconstructed ${reconstructedEmptyElements}`);
        }

        // Check for attribute order differences (non-critical)
        this.checkAttributeOrderDifferences(originalIDML, reconstructedIDML, validation);
    }

    /**
     * Check for attribute order differences (non-critical)
     */
    private checkAttributeOrderDifferences(
        originalIDML: string,
        reconstructedIDML: string,
        validation: RoundTripValidationResult
    ): void {
        // Extract all elements with attributes
        const originalElements = originalIDML.match(/<[^>]+>/g) || [];
        const reconstructedElements = reconstructedIDML.match(/<[^>]+>/g) || [];

        if (originalElements.length !== reconstructedElements.length) {
            validation.warnings.push(`Element count mismatch: original ${originalElements.length}, reconstructed ${reconstructedElements.length}`);
        }
    }

    /**
     * Generate validation report
     */
    generateValidationReport(validation: RoundTripValidationResult): string {
        const report: string[] = [];

        report.push('=== InDesign Round-Trip Validation Report ===');
        report.push(`Validation Time: ${validation.validationTimestamp}`);
        report.push(`Original Hash: ${validation.originalHash}`);
        report.push(`Reconstructed Hash: ${validation.reconstructedHash}`);
        report.push(`Is Loss-Free: ${validation.isLossFree ? 'YES' : 'NO'}`);
        report.push('');

        if (validation.errors.length > 0) {
            report.push('ERRORS:');
            validation.errors.forEach(error => report.push(`  - ${error}`));
            report.push('');
        }

        if (validation.differences.length > 0) {
            report.push('DIFFERENCES:');
            validation.differences.forEach(diff => {
                report.push(`  - ${diff.type.toUpperCase()}: ${diff.location}`);
                report.push(`    Severity: ${diff.severity}`);
                report.push(`    Original: ${diff.original}`);
                report.push(`    Reconstructed: ${diff.reconstructed}`);
                report.push('');
            });
        }

        if (validation.warnings.length > 0) {
            report.push('WARNINGS:');
            validation.warnings.forEach(warning => report.push(`  - ${warning}`));
            report.push('');
        }

        report.push('=== End of Report ===');

        return report.join('\n');
    }

    /**
     * Validate that a document meets loss-free requirements
     */
    async validateLossFree(document: IDMLDocument, reconstructedIDML: string): Promise<boolean> {
        const validation = await this.validateRoundTrip(
            '', // We don't have the original IDML string here
            reconstructedIDML,
            document
        );

        if (!validation.isLossFree) {
            const report = this.generateValidationReport(validation);
            throw new IDMLValidationError(
                `Document does not meet loss-free requirements:\n${report}`,
                validation
            );
        }

        return true;
    }
}
