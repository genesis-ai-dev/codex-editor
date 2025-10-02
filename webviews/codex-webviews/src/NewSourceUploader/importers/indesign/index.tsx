/**
 * InDesign Importer Plugin with Round-Trip Validation
 * Imports IDML files with loss-free editing capabilities
 */

import React from 'react';
import { ImporterPlugin } from '../../types/plugin';
import { FileText } from 'lucide-react';
import { InDesignImporterForm } from './InDesignImporterForm';

export const indesignImporterPlugin: ImporterPlugin = {
    id: 'indesign-importer',
    name: 'InDesign Files',
    description: 'Adobe InDesign IDML files with round-trip loss-free editing',
    icon: FileText,
    component: InDesignImporterForm,
    supportedExtensions: ['idml'],
    supportedMimeTypes: ['application/vnd.adobe.indesign-idml-package'],
    enabled: true,
    tags: ['Essential', 'Documents', 'Adobe', 'Professional', 'RoundTrip'],
};
