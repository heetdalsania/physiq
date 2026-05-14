import React from "react";
import { exportAll } from "../utils/storage.js";
import { emitToast } from "../utils/toast.js";
import { triggerHaptic } from "../utils/native.js";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.handleExport = this.handleExport.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught:", error, info);
  }

  handleExport() {
    const snapshot = exportAll();
    let blobUrl = null;
    try {
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = "physiq-backup-" + stamp + ".json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      triggerHaptic("light");
      emitToast("Exported " + Object.keys(snapshot.data).length + " entries", { type: "info" });
    } catch (e) {
      emitToast("Export failed", { type: "error" });
    } finally {
      if (blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary fade-in" style={{ padding: 24, textAlign: "center", color: "var(--text-white)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 300 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 20, marginBottom: 8, color: "var(--red)" }}>Something went wrong.</h2>
          <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 24, maxWidth: 300 }}>A display error occurred. Your data is safe. You can reload the app or export your data for backup.</p>
          <button className="btn btn-primary" onClick={function() { window.location.reload(); }} style={{ marginBottom: 12, width: "100%", maxWidth: 200 }}>Reload App</button>
          <button className="btn btn-secondary" onClick={this.handleExport} style={{ width: "100%", maxWidth: 200 }}>Export Data</button>
        </div>
      );
    }
    return this.props.children;
  }
}
