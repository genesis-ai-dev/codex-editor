/**
 * Biblica Importer Plugin
 * Experimental single-file Biblica profile on the shared IDML v2 engine.
 * Deterministic Study Bible + translated Bible replacement is not enabled yet.
 */

import React from 'react';
import { ImporterPlugin } from '../../types/plugin';
import { FileText } from 'lucide-react';
import { BiblicaImporterForm } from './BiblicaImporterForm';

export const biblicaImporterPlugin: ImporterPlugin = {
    id: 'biblica-importer',
    name: 'Biblica Files',
    description: 'Experimental single-file Biblica IDML v2 import; two-file Bible-text replacement is not yet enabled',
    icon: FileText,
    component: BiblicaImporterForm,
    supportedExtensions: ['idml'],
    supportedMimeTypes: ['application/vnd.adobe.indesign-idml-package'],
    enabled: true,
};
