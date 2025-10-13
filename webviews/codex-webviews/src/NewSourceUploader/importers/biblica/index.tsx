/**
 * Biblica Importer Plugin (IDML-based, Biblica-specific handling)
 */

import React from 'react';
import { ImporterPlugin } from '../../types/plugin';
import { FileText } from 'lucide-react';
import { BiblicaImporterForm } from './BiblicaImporterForm';

export const biblicaImporterPlugin: ImporterPlugin = {
    id: 'biblica-importer',
    name: 'Biblica Files',
    description: 'Biblica IDML files',
    icon: FileText,
    component: BiblicaImporterForm,
    supportedExtensions: ['idml'],
    supportedMimeTypes: ['application/vnd.adobe.indesign-idml-package'],
    enabled: true,
    tags: ['Specialized', 'Bible', 'Biblica'],
};
