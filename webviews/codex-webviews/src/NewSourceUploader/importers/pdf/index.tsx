import React from 'react';
import { ImporterPlugin } from '../../types/plugin';
import { pdfImporter } from './index';
import { PdfImporterForm } from './pdfImporterForm';

/**
 * PDF Importer Plugin with UI components
 */
export const pdfImporterPlugin: ImporterPlugin = {
    ...pdfImporter,
    id: 'pdf-importer',
    icon: () => React.createElement('div'), // Will be overridden in registry
    component: PdfImporterForm,
};
