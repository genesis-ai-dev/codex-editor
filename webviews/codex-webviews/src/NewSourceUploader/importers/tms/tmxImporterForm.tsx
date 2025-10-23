import React, { useState, useCallback } from 'react';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Progress } from '../../../components/ui/progress';
import { Badge } from '../../../components/ui/badge';
import { FileCode, Upload, CheckCircle, AlertCircle, Info, ArrowLeft } from 'lucide-react';
import { ImporterComponentProps } from '../../types/plugin';
import { validateFile, parseFile } from './index';
import { FileValidationResult, ImportResult } from '../../types/common';

console.log('Form loaded parseFile function:', typeof parseFile);

interface ValidationState {
    isValidating: boolean;
    result: FileValidationResult | null;
    error: string | null;
}

interface ImportState {
    isImporting: boolean;
    progress: number;
    stage: string;
    result: ImportResult | null;
    error: string | null;
}

export const TmxImporterForm: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
    onCancelImport,
    wizardContext,
    onTranslationComplete,
    alignContent,
}) => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [validationState, setValidationState] = useState<ValidationState>({
        isValidating: false,
        result: null,
        error: null,
    });
    const [importState, setImportState] = useState<ImportState>({
        isImporting: false,
        progress: 0,
        stage: '',
        result: null,
        error: null,
    });

    // Determine if this is a target import
    const isTargetImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    const handleFileSelect = useCallback(async (file: File) => {
        setSelectedFile(file);
        setValidationState({ isValidating: true, result: null, error: null });
        setImportState({ isImporting: false, progress: 0, stage: '', result: null, error: null });

        try {
            const validationResult = await validateFile(file);
            setValidationState({ isValidating: false, result: validationResult, error: null });
        } catch (error) {
            setValidationState({
                isValidating: false,
                result: null,
                error: error instanceof Error ? error.message : 'Validation failed',
            });
        }
    }, []);

    const handleImport = useCallback(async () => {
        if (!selectedFile || !validationState.result?.isValid) return;

        setImportState({ isImporting: true, progress: 0, stage: 'Starting import...', result: null, error: null });

        try {
            console.log(`🎯 Form calling parseFile with: isTargetImport=${isTargetImport}`);
            const result = await parseFile(selectedFile, (progress) => {
                setImportState(prev => ({
                    ...prev,
                    progress: progress.progress || 0,
                    stage: progress.stage,
                }));
            }, isTargetImport, false, false, false); // Pass false for Bible options (not used anymore)

            setImportState(prev => ({
                ...prev,
                isImporting: false,
                result,
                error: result.success ? null : result.error || 'Import failed',
            }));

            if (result.success) {
                if (isTargetImport && onTranslationComplete && alignContent) {
                    // Handle target import - convert to ImportedContent and align
                    const notebookPair = result.notebookPair || (result.notebookPairs && result.notebookPairs[0]);
                    const importedContent = notebookPair?.source.cells.map(cell => ({
                        id: cell.id,
                        content: cell.content.replace(/<[^>]*>/g, ''), // Remove HTML tags
                        metadata: cell.metadata,
                    })) || [];

                    try {
                        // Pass the source file path from wizard context instead of the TMX filename
                        const sourceFilePath = wizardContext?.selectedSourceDetails?.path || selectedSource?.path || '';
                        const alignedContent = await alignContent(importedContent, sourceFilePath);
                        onTranslationComplete(alignedContent, sourceFilePath);
                    } catch (alignError) {
                        setImportState(prev => ({
                            ...prev,
                            error: `Alignment failed: ${alignError instanceof Error ? alignError.message : 'Unknown error'}`,
                        }));
                    }
                } else if (onComplete) {
                    // Handle source import - complete with multiple notebooks (one per book)
                    if (result.notebookPairs && result.notebookPairs.length > 0) {
                        // Multiple notebooks (one per Bible book) - pass as array like RTF importer
                        onComplete(result.notebookPairs);
                    } else if (result.notebookPair) {
                        // Fallback to single notebook
                        onComplete(result.notebookPair);
                    }
                }
            }
        } catch (error) {
            setImportState({
                isImporting: false,
                progress: 0,
                stage: '',
                result: null,
                error: error instanceof Error ? error.message : 'Import failed',
            });
        }
    }, [selectedFile, validationState.result, onComplete, onTranslationComplete, alignContent, isTargetImport, selectedSource?.path, wizardContext?.selectedSourceDetails?.path]);

    const getFileTypeInfo = (fileName: string) => {
        const extension = fileName.split('.').pop()?.toLowerCase();
        if (extension === 'tmx') {
            return {
                type: 'TMX',
                description: 'Translation Memory eXchange',
                color: 'bg-green-100 text-green-800',
            };
        } else if (extension === 'xliff' || extension === 'xlf') {
            return {
                type: 'XLIFF',
                description: 'XML Localization Interchange File Format',
                color: 'bg-blue-100 text-blue-800',
            };
        }
        return {
            type: 'Unknown',
            description: 'Unknown file type',
            color: 'bg-gray-100 text-gray-800',
        };
    };

    const fileTypeInfo = selectedFile ? getFileTypeInfo(selectedFile.name) : null;

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileCode className="h-6 w-6" />
                        Import Translation Files {isTargetImport && "(Translation)"}
                    </h1>
                    {isTargetImport && selectedSource && (
                        <p className="text-muted-foreground">
                            Importing translation for:{" "}
                            <span className="font-medium">{selectedSource.name}</span>
                        </p>
                    )}
                </div>
                <Button variant="ghost" onClick={onCancel} className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Home
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Select Translation File</CardTitle>
                    <CardDescription>
                        {isTargetImport ? (
                            <>
                                Import target translation from translation file for: <strong>{selectedSource?.name}</strong>
                                <br />
                                This will extract the target language text from the TMX/XLIFF file and align it with the source.
                            </>
                        ) : (
                            <>
                                Import source translation from translation file.
                                This will extract the source language text from the TMX/XLIFF file.
                            </>
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2 mb-4">
                        <Badge variant="outline">.tmx</Badge>
                        <Badge variant="outline">.xliff</Badge>
                        <Badge variant="outline">.xlf</Badge>
                        <Badge variant="outline">Translation Memory</Badge>
                    </div>

                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".tmx,.xliff,.xlf"
                            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                            className="hidden"
                            id="file-input"
                            disabled={validationState.isValidating || importState.isImporting}
                        />
                        <label
                            htmlFor="file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-4"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <div className="space-y-2">
                                <div className="text-lg font-medium">Choose your TMX file</div>
                                <div className="text-sm text-muted-foreground">
                                    Click to select a .tmx file up to 50MB
                                </div>
                            </div>
                        </label>
                    </div>

                    {selectedFile && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <span className="font-medium">Selected file:</span>
                                <Badge className={fileTypeInfo?.color}>
                                    {fileTypeInfo?.type}
                                </Badge>
                                <span className="text-sm text-gray-600">{selectedFile.name}</span>
                            </div>

                            {validationState.isValidating && (
                                <Alert>
                                    <Info className="h-4 w-4" />
                                    <AlertDescription>
                                        Validating file format and content...
                                    </AlertDescription>
                                </Alert>
                            )}

                            {validationState.error && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        {validationState.error}
                                    </AlertDescription>
                                </Alert>
                            )}

                            {validationState.result && (
                                <div className="space-y-2">
                                    {validationState.result.isValid ? (
                                        <Alert>
                                            <CheckCircle className="h-4 w-4" />
                                            <AlertDescription>
                                                File validation successful! Found {validationState.result.fileType} format.
                                            </AlertDescription>
                                        </Alert>
                                    ) : (
                                        <Alert variant="destructive">
                                            <AlertCircle className="h-4 w-4" />
                                            <AlertDescription>
                                                File validation failed. Please check the errors below.
                                            </AlertDescription>
                                        </Alert>
                                    )}

                                    {validationState.result.errors.length > 0 && (
                                        <div className="space-y-1">
                                            <span className="text-sm font-medium text-red-600">Errors:</span>
                                            <ul className="text-sm text-red-600 list-disc list-inside">
                                                {validationState.result.errors.map((error, index) => (
                                                    <li key={index}>{error}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {validationState.result.warnings.length > 0 && (
                                        <div className="space-y-1">
                                            <span className="text-sm font-medium text-yellow-600">Warnings:</span>
                                            <ul className="text-sm text-yellow-600 list-disc list-inside">
                                                {validationState.result.warnings.map((warning, index) => (
                                                    <li key={index}>{warning}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {validationState.result.metadata && (
                                        <div className="text-sm text-gray-600">
                                            <p>File size: {(validationState.result.metadata.fileSize / 1024).toFixed(1)} KB</p>
                                            <p>Last modified: {new Date(validationState.result.metadata.lastModified).toLocaleString()}</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {importState.isImporting && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Upload className="h-4 w-4 animate-spin" />
                                        <span className="text-sm font-medium">{importState.stage}</span>
                                    </div>
                                    <Progress value={importState.progress} className="w-full" />
                                </div>
                            )}

                            {importState.error && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        {importState.error}
                                    </AlertDescription>
                                </Alert>
                            )}

                            {importState.result && importState.result.success && (
                                <Alert>
                                    <CheckCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        Import completed successfully! Created {importState.result.metadata?.booksCreated || 0} Bible books with {importState.result.metadata?.translationUnitCount || 0} translation units.
                                    </AlertDescription>
                                </Alert>
                            )}
                        </div>
                    )}

                    <div className="flex gap-2">
                        <Button
                            onClick={handleImport}
                            disabled={!selectedFile || !validationState.result?.isValid || importState.isImporting}
                            className="flex-1"
                        >
                            <Upload className="h-4 w-4 mr-2" />
                            Import File
                        </Button>
                        <Button
                            variant="outline"
                            onClick={onCancel}
                            disabled={importState.isImporting}
                        >
                            Back
                        </Button>
                        <Button
                            variant="outline"
                            onClick={onCancelImport}
                            disabled={importState.isImporting}
                        >
                            Cancel Import
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};