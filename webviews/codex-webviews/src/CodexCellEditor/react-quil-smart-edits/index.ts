import { SmartEditsManager } from './SmartEditsManager';
import { GrammarChecker } from './GrammarChecker';
import { SmartPopupManager } from './smartPopupManager';
import './QuillSmartEdits.css';

export { SmartEditsManager, GrammarChecker, SmartPopupManager };

export default function registerQuillSmartEdits(Quill: any) {
    Quill.register('modules/smartEdits', SmartEditsManager);
}