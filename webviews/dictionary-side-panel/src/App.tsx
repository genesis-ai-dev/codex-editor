import { vscode } from "./utilities/vscode";
import { useEffect, useState } from 'react'
import { Dictionary } from 'codex-types';
import { numberOfEntries } from './utils';
import './App.css'

function App() {
  const [entries, setEntries] = useState(0);


  useEffect(() => {
    const handleReceiveMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case 'sendData': {
          const dictionary: Dictionary = message.data;
          setEntries(numberOfEntries(dictionary));
          console.log('Number of entries in dictionary:', entries);
          break;
        }
      }
    };
    window.addEventListener('message', handleReceiveMessage);
    return () => {
      window.removeEventListener('message', handleReceiveMessage);
    };
  }, []);

  // Get dictionary data
  vscode.postMessage({ command: "updateData" });

  return (
    <>
      <h1>Dictionary Summary</h1>
      <div className="card">
        {/* Print out number of entries in dictionary from const entries var */}
        <p>Entries in dictionary: {entries}</p>
        <button onClick={() => {
          vscode.postMessage({ command: "showDictionaryTable" });
        }}>
          Show Dictionary Table
        </button>
      </div>
    </>
  );
}

export default App
