import React, { useState, useEffect } from "react";
import {
  VSCodePanelTab,
  VSCodePanelView,
  VSCodePanels,
  VSCodeButton,
  VSCodeTextArea,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { Uri } from "vscode";

const vscode = acquireVsCodeApi();

interface Item {
  reference: string;
  uri: string;
  before: string;
  after: string;
}

interface OpenFileMessage {
  command: "openFileAtLocation";
  uri: string;
}

interface ApplyEditMessage {
  command: "applyEdit";
  uri: string;
  before: string;
  after: string;
}

interface IgnoreMessage {
  command: "ignore";
  reference: string;
}

interface UndoMessage {
  command: "undo";
  uri: string;
  before: string;
  after: string;
}

interface SearchCommand {
  command: "edits";
  reference: string;
  before: string;
  after: string;
}

const CodexItem: React.FC<{
  item: Item;
  itemState: "applied" | "ignored" | null;
  onApplyEdit: (uri: string, reference: string, before: string, after: string) => void;
  onIgnore: (reference: string) => void;
  onUndo: (uri: string, reference: string, before: string, after: string) => void;
}> = ({ item, itemState, onApplyEdit, onIgnore, onUndo }) => {
  const handleApplyEdit = () => {
    onApplyEdit(item.uri, item.reference, item.before, item.after);
  };

  const handleIgnore = () => {
    onIgnore(item.reference);
  };

  const handleUndo = () => {
    onUndo(item.uri, item.reference, item.after, item.before);
  };

  return (
    <div className="codex-item">
      <h3>{item.reference}</h3>
      <div className="codex-item-content">
        <div>
          <h4>Original Text Snippet</h4>
          <p>{item.before}</p>
        </div>
        <div>
          <h4>Suggested Edit</h4>
          <p>{item.after}</p>
        </div>
      </div>
      <div className="codex-item-actions">
        {itemState === null && (
          <>
            <VSCodeButton appearance="primary" onClick={handleApplyEdit}>
              Apply Edit
            </VSCodeButton>
            <VSCodeButton appearance="secondary" onClick={handleIgnore}>
              Ignore
            </VSCodeButton>
          </>
        )}
        {itemState === "applied" && (
          <VSCodeButton appearance="secondary" onClick={handleUndo}>
            Undo Edit
          </VSCodeButton>
        )}
        {itemState === "ignored" && (
          <VSCodeButton appearance="secondary" onClick={handleUndo}>
            Undo Ignore
          </VSCodeButton>
        )}
      </div>
    </div>
  );
};

function App() {
  const [searchResults, setSearchResults] = useState<Item[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [itemStates, setItemStates] = useState<Record<string, "applied" | "ignored" | null>>({});
  const [before, setBefore] = useState("");
  const [afterLine, setAfterLine] = useState("");

  useEffect(() => {
    let firstLineResult = true;

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "editResults":
          setSearchResults((prevResults) => [...prevResults, ...message.data]);
          break;
        case "completed":
          setLoading(false);
          break;
        case "lineresult":
          if (firstLineResult) {
            setBefore(message.line);
            firstLineResult = false;
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const handleApplyEdit = (uri: string, reference: string, before: string, after: string) => {
    vscode.postMessage({
      command: "applyEdit",
      uri: uri,
      before: before,
      after: after,
    } as ApplyEditMessage);
    setItemStates((prevStates) => ({ ...prevStates, [reference]: "applied" }));
  };

  const handleIgnore = (reference: string) => {
    vscode.postMessage({
      command: "ignore",
      reference,
    } as IgnoreMessage);
    setItemStates((prevStates) => ({ ...prevStates, [reference]: "ignored" }));
  };

  const handleUndo = (uri: string, reference: string, before: string, after: string) => {
    vscode.postMessage({
      command: "undo",
      uri: uri,
      before,
      after,
    } as UndoMessage);
    setItemStates((prevStates) => ({ ...prevStates, [reference]: null }));
  };

  const searchForEdits = (before: string, after: string) => {
    if (!before || !after) {
      setFormError("Please fill in both 'before' and 'after' fields.");
      return;
    }
    setFormError(null);
    setLoading(true);
    vscode.postMessage({
      command: "edits",
      before,
      after,
    } as SearchCommand);
  };

  return (
    <VSCodePanels>
      <VSCodePanelTab id="tab1">Draft</VSCodePanelTab>
      <VSCodePanelView id="view1">
        <DraftTab
          searchResults={searchResults}
          loading={loading}
          formError={formError}
          itemStates={itemStates}
          before={before}
          setBefore={setBefore}
          afterLine={afterLine}
          setAfterLine={setAfterLine}
          onApplyEdit={handleApplyEdit}
          onIgnore={handleIgnore}
          onUndo={handleUndo}
          onSearchForEdits={searchForEdits}
        />
      </VSCodePanelView>
    </VSCodePanels>
  );
}

const DraftTab: React.FC<{
  searchResults: Item[];
  loading: boolean;
  formError: string | null;
  itemStates: Record<string, "applied" | "ignored" | null>;
  before: string;
  setBefore: (value: string) => void;
  afterLine: string;
  setAfterLine: (value: string) => void;
  onApplyEdit: (uri: string, reference: string, before: string, after: string) => void;
  onIgnore: (reference: string) => void;
  onUndo: (uri: string, reference: string, before: string, after: string) => void;
  onSearchForEdits: (before: string, after: string) => void;
}> = ({
  searchResults,
  loading,
  formError,
  itemStates,
  before,
  setBefore,
  afterLine,
  setAfterLine,
  onApplyEdit,
  onIgnore,
  onUndo,
  onSearchForEdits,
}) => {
  return (
    <div className="draft-tab">
      <h2>Before edit example:</h2>
      <VSCodeTextArea
        id="before"
        placeholder="Enter original text."
        value={before}
        onChange={(e) => setBefore((e.target as HTMLInputElement).value)}
        rows={10}
      />
      <h2>After edit example:</h2>
      <VSCodeTextArea
        id="after"
        placeholder="Enter ideal text."
        onChange={(e) => setAfterLine((e.target as HTMLInputElement).value)}
        rows={10}
      />
      {formError && <div className="form-error">{formError}</div>}
      <VSCodeButton
        appearance="primary"
        onClick={() => onSearchForEdits(before, afterLine)}
        disabled={loading}
      >
        {loading ? "Searching..." : "Find Smart Edits"}
      </VSCodeButton>

      <div className="results-container">
        {!loading && searchResults.length === 0 && (
          <div className="empty-state">
            <span className="codicon codicon-search"></span>
            <span>No edits found. Try modifying your search.</span>
          </div>
        )}
        {searchResults.map((result) => (
          <CodexItem
            key={result.reference}
            item={result}
            itemState={itemStates[result.reference] || null}
            onApplyEdit={onApplyEdit}
            onIgnore={onIgnore}
            onUndo={onUndo}
          />
        ))}
      </div>
    </div>
  );
};

export default App;