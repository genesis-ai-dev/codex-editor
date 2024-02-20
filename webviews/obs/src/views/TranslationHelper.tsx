import { renderToPage } from "../utilities/main-vscode";

const TranslationHelper = () => {
    return (
        <div>
            <h1>Should be rendering, something is wrong</h1>
        </div>
    );
};

renderToPage(<TranslationHelper />);
