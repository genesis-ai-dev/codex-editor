/**
 * Biblica Importer Plugin
 * IDML-based importer with two-file support (Study Bible + Translated Bible)
 */

import React from 'react';
import { ImporterPlugin } from '../../types/plugin';
import { FileText } from 'lucide-react';
import { BiblicaImporterForm } from './BiblicaImporterForm';

export const biblicaImporterPlugin: ImporterPlugin = {
    id: 'biblica-importer',
    name: 'Biblica Files',
    description: 'Biblica IDML importer with Study Bible + Translated Bible support',
    icon: FileText,
    component: BiblicaImporterForm,
    supportedExtensions: ['idml'],
    supportedMimeTypes: ['application/vnd.adobe.indesign-idml-package'],
    enabled: true,
};
