import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { AutomatedTestingView } from "./AutomatedTestingView";

declare global { interface Window { acquireVsCodeApi: any; } }
const vscode = window.acquireVsCodeApi?.();
console.log('[AutomatedTesting] VSCode API available:', !!vscode);
console.log('[AutomatedTesting] acquireVsCodeApi function available:', !!window.acquireVsCodeApi);

function App() {
  const [ready, setReady] = useState(false);
  const [batch, setBatch] = useState<any>(null);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.command === "batchResults") setBatch(e.data.data);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
  return <AutomatedTestingView vscode={vscode} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


