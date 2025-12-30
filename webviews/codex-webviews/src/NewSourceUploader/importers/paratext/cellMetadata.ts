/**
 * Cell Metadata Builder for Paratext Importer
 * 
 * This file centralizes all cell metadata structure creation for Paratext imports.
 * Paratext uses USFM format, so we re-export and use the USFM cell metadata functions
 * to ensure consistency with UUID generation, globalReferences, and milestones.
 */

// Re-export USFM cell metadata functions since Paratext uses USFM format
export {
    createVerseCellMetadata,
    createParatextCellMetadata,
    createHeaderCellMetadata,
    type VerseCellMetadataParams,
    type ParatextCellMetadataParams,
    type HeaderCellMetadataParams,
} from '../usfm/cellMetadata';

/**
 * Paratext-specific cell metadata functions can be added here if needed in the future.
 * For now, Paratext uses the same cell metadata structure as USFM since it processes USFM files.
 */
