import React, { useCallback, useEffect, useState } from "react";

type VSCode = { postMessage: (msg: any) => void } | undefined;

interface TestResult {
  cellId: string;
  sourceContent: string;
  referenceTranslation: string;
  generatedTranslation: string;
  chrfScore: number;
  timestamp: string;
}

interface TestSummary {
  testId: string;
  timestamp: string;
  cellCount: number;
  averageCHRF: number;
  results: TestResult[];
  error?: string;
}

interface HistoryItem {
  path: string;
  testId: string;
  timestamp: string;
  averageCHRF: number;
  cellCount: number;
}

export function AutomatedTestingView({ vscode }: { vscode: VSCode }) {
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [newId, setNewId] = useState("");
  const [count, setCount] = useState(10);
  const [onlyValidated, setOnlyValidated] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [results, setResults] = useState<TestSummary | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [banner, setBanner] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"config" | "history">("config");

  // Handle messages from backend
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.command === "testResults") {
        setResults(msg.data);
        setRunning(false);
        setStatus("");
        vscode?.postMessage({ command: "getHistory" });
      }
      if (msg?.command === "historyData") {
        setHistory(Array.isArray(msg.data) ? msg.data : []);
      }
      if (msg?.command === "configReapplied") {
        setBanner(msg.data?.ok ? "Configuration reapplied." : "Failed to reapply configuration.");
        setTimeout(() => setBanner(""), 2500);
      }
      if (msg?.command === "cellIdsPopulated") {
        const ids = (msg.data?.cellIds || "")
          .split(/,|\r?\n/)
          .map((s: string) => s.trim())
          .filter(Boolean);
        setManualIds(ids);
        setActiveTab("config");
        setBanner("Cell IDs populated.");
        setTimeout(() => setBanner(""), 2000);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [vscode]);

  useEffect(() => {
    vscode?.postMessage({ command: "getHistory" });
  }, [vscode]);

  const addManualId = useCallback(() => {
    const trimmed = newId.trim();
    if (!trimmed) return;
    if (manualIds.includes(trimmed)) {
      setNewId("");
      return;
    }
    setManualIds(prev => [...prev, trimmed]);
    setNewId("");
  }, [newId, manualIds]);

  const removeManualId = useCallback((id: string) => {
    setManualIds(prev => prev.filter(x => x !== id));
  }, []);

  const onRunTest = useCallback(() => {
    if (running) return;
    setRunning(true);
    setResults(null);
    setStatus("Preparing test…");

    const cellIdList = manualIds.length ? manualIds : [];

    vscode?.postMessage({
      command: "runTest",
      data: { cellIds: cellIdList, count, onlyValidated }
    });
  }, [manualIds, count, onlyValidated, running, vscode]);

  const onLoadTest = useCallback((path: string) => {
    vscode?.postMessage({ command: "loadTest", data: { path } });
    setActiveTab("config");
  }, [vscode]);

  const onReapplyConfig = useCallback((path: string) => {
    vscode?.postMessage({ command: "reapplyConfig", data: { path } });
  }, [vscode]);

  const onPopulateCellIds = useCallback((path: string) => {
    vscode?.postMessage({ command: "populateCellIds", data: { path } });
  }, [vscode]);

  const Summary = ({ summary }: { summary: TestSummary }) => (
    <div style={{
      backgroundColor: "#f8fafc",
      padding: 12,
      borderRadius: 10,
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 12,
      textAlign: "center",
      border: "1px solid #e5e7eb"
    }}>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>
          {((summary.averageCHRF || 0) * 100).toFixed(1)}%
        </div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>Average CHRF</div>
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>
          {summary.cellCount}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>Cells Tested</div>
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#111827" }}>
          {new Date(summary.timestamp).toLocaleTimeString()}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280" }}>Completed</div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          onClick={() => setActiveTab("config")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: activeTab === "config" ? "1px solid #3b82f6" : "1px solid #e5e7eb",
            backgroundColor: activeTab === "config" ? "#eff6ff" : "white",
            color: activeTab === "config" ? "#1d4ed8" : "#374151",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13
          }}
        >
          Configuration
        </button>
        <button
          onClick={() => setActiveTab("history")}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: activeTab === "history" ? "1px solid #3b82f6" : "1px solid #e5e7eb",
            backgroundColor: activeTab === "history" ? "#eff6ff" : "white",
            color: activeTab === "history" ? "#1d4ed8" : "#374151",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13
          }}
        >
          History
        </button>
      </div>

      {banner && (
        <div style={{ marginBottom: 10, padding: 10, border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8", borderRadius: 8, fontSize: 12 }}>
          {banner}
        </div>
      )}

      {running && (
        <div style={{ marginBottom: 10, padding: 10, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#374151", borderRadius: 8, fontSize: 12 }}>
          {status || "Running test…"}
        </div>
      )}

      {/* Config tab */}
      {activeTab === "config" && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
          <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 16, color: "#111827" }}>Test Configuration</h3>

          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Cell ID</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="Type a cell ID and press Enter"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManualId(); } }}
                  style={{
                    flex: 1,
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    fontSize: 13
                  }}
                />
                <button onClick={addManualId} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>Add</button>
              </div>
              {manualIds.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {manualIds.map(id => (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: 999, background: "#f3f4f6", fontSize: 12 }}>
                      <span>{id}</span>
                      <button onClick={() => removeManualId(id)} style={{ border: 0, background: "transparent", cursor: "pointer", fontWeight: 700, color: "#6b7280" }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "end" }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Random Count</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value || "10", 10))}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13 }}
                />
              </div>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, fontWeight: 500, color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={onlyValidated} onChange={(e) => setOnlyValidated(e.target.checked)} style={{ transform: "scale(1.1)" }} />
                Only validated cells
              </label>
            </div>

            <button
              onClick={onRunTest}
              disabled={running}
              style={{
                padding: 10,
                borderRadius: 10,
                cursor: running ? "not-allowed" : "pointer",
                backgroundColor: running ? "#9ca3af" : "#111827",
                color: "white",
                border: "none",
                fontWeight: 700,
                fontSize: 13,
                transition: "all 0.2s ease"
              }}
            >
              {running ? "Running Test…" : "Run Translation Quality Test"}
            </button>
          </div>
        </div>
      )}

      {/* History tab */}
      {activeTab === "history" && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
          <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 16, color: "#111827" }}>Test History</h3>
          <div style={{ display: "grid", gap: 12 }}>
            {history.length === 0 && (
              <div style={{ fontSize: 13, color: "#6b7280", textAlign: "center", padding: 20 }}>No tests run yet</div>
            )}
            {history.map(h => (
              <div key={h.path} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, backgroundColor: "#fafafa" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>{new Date(h.timestamp).toLocaleDateString()} {new Date(h.timestamp).toLocaleTimeString()}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{h.cellCount} cells • Avg {(h.averageCHRF * 100).toFixed(1)}%</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => onLoadTest(h.path)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>View</button>
                    <button onClick={() => onPopulateCellIds(h.path)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>Same Cells</button>
                    <button onClick={() => onReapplyConfig(h.path)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "white", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>Reapply</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginTop: 16 }}>
          <h3 style={{ fontWeight: 700, marginBottom: 12, fontSize: 16, color: "#111827" }}>Test Results</h3>
          {results.error ? (
            <div style={{ color: "#dc2626", fontSize: 13, padding: 12, backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>Error: {results.error}</div>
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              <Summary summary={results} />
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#374151" }}>Individual Results</h4>
                <div style={{ maxHeight: 600, overflowY: "auto", display: "grid", gap: 12 }}>
                  {results.results.map(r => (
                    <div key={r.cellId} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, backgroundColor: "#ffffff" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{r.cellId}</span>
                        <span style={{ fontWeight: 700, fontSize: 16, padding: "4px 8px", borderRadius: 6, backgroundColor: r.chrfScore > 0.7 ? "#dcfce7" : r.chrfScore > 0.4 ? "#fef3c7" : "#fee2e2", color: r.chrfScore > 0.7 ? "#059669" : r.chrfScore > 0.4 ? "#d97706" : "#dc2626" }}>{((r.chrfScore || 0) * 100).toFixed(1)}%</span>
                      </div>
                      <div style={{ display: "grid", gap: 12 }}>
                        <div>
                          <div style={{ color: "#374151", marginBottom: 4, fontWeight: 700, fontSize: 12 }}>SOURCE</div>
                          <div style={{ whiteSpace: "pre-wrap", border: "1px solid #d1d5db", borderRadius: 8, padding: 10, background: "#ffffff", fontSize: 13, lineHeight: 1.5 }}>{r.sourceContent || ""}</div>
                        </div>
                        <div>
                          <div style={{ color: "#374151", marginBottom: 4, fontWeight: 700, fontSize: 12 }}>REFERENCE</div>
                          <div style={{ whiteSpace: "pre-wrap", border: "1px solid #d1d5db", borderRadius: 8, padding: 10, background: "#ffffff", fontSize: 13, lineHeight: 1.5 }}>{r.referenceTranslation || ""}</div>
                        </div>
                        <div>
                          <div style={{ color: "#374151", marginBottom: 4, fontWeight: 700, fontSize: 12 }}>GENERATED</div>
                          <div style={{ whiteSpace: "pre-wrap", border: "1px solid #d1d5db", borderRadius: 8, padding: 10, background: "#ffffff", fontSize: 13, lineHeight: 1.5 }}>{r.generatedTranslation || ""}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}