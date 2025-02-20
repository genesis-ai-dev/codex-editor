import React from 'react';
import {
    VSCodeButton,
    VSCodeCheckbox,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeOption,
    VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react";

export interface ExportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onExport: (format: string, includeStyles: boolean) => void;
}

const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose, onExport }) => {
    const [selectedFormat, setSelectedFormat] = React.useState('vtt');
    const [includeStyles, setIncludeStyles] = React.useState(false);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ width: '300px' }}>
                <h2>Export Subtitles</h2>
                <VSCodeDivider />
                <div style={{ marginTop: '1rem' }}>
                    <label>Export Format:</label>
                    <VSCodeDropdown
                        style={{ width: '100%', marginTop: '0.5rem' }}
                        value={selectedFormat}
                        onChange={(e) => setSelectedFormat((e.target as HTMLSelectElement).value)}
                    >
                        <VSCodeOption value="vtt">WebVTT (.vtt)</VSCodeOption>
                        <VSCodeOption value="srt">SubRip (.srt)</VSCodeOption>
                    </VSCodeDropdown>
                </div>
                <div style={{ marginTop: '1rem' }}>
                    <VSCodeCheckbox
                        checked={includeStyles}
                        onChange={(e) => setIncludeStyles((e.target as HTMLInputElement).checked)}
                    >
                        Include HTML and styling
                    </VSCodeCheckbox>
                </div>
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <VSCodeButton appearance="secondary" onClick={onClose}>
                        Cancel
                    </VSCodeButton>
                    <VSCodeButton onClick={() => onExport(selectedFormat, includeStyles)}>
                        Export
                    </VSCodeButton>
                </div>
            </div>
        </div>
    );
};

export default ExportDialog; 