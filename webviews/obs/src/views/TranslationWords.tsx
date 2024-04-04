import { useEffect, useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import { vscode } from "../utilities/vscode";
import { TranslationWord } from "../types";
import TranslationWordsDropdown from "../components/TranslationWordsDropdown";
import TranslationWordRenderer from "../components/TranslationWordRenderer";

const TranslationWords = () => {
    const [translationWord, setTranslationWord] =
        useState<TranslationWord | null>(null);
    useEffect(() => {
        vscode.setMessageListeners();
    }, []);
    return (
        <div className="flex flex-col">
            <TranslationWordsDropdown
                setTranslationWord={setTranslationWord}
                selectedTranslationWord={translationWord}
            />
            <TranslationWordRenderer translationWord={translationWord} />
        </div>
    );
};

renderToPage(<TranslationWords />);
