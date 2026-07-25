/**
 * Experimental IDML v2 protected-text round-trip importer.
 * Native fidelity remains gated on automated Adobe validation.
 */

import React from 'react';
import { ImporterPlugin } from '../../types/plugin';
import { FileText } from 'lucide-react';
import { InDesignImporterForm } from './InDesignImporterForm';

export const indesignImporterPlugin: ImporterPlugin = {
    id: 'indesign-importer',
    name: 'InDesign Files',
    description: 'Experimental IDML v2 protected-text round-trip; native fidelity is not yet enabled',
    icon: FileText,
    component: InDesignImporterForm,
    supportedExtensions: ['idml'],
    supportedMimeTypes: ['application/vnd.adobe.indesign-idml-package'],
    enabled: true,
};
