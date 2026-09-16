import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { installExportFailDiagnostics } from "./core/exporter/export-fail-dump";
import "./styles.css";

installExportFailDiagnostics();

const root = document.getElementById("root");
if (!root) {
  throw new Error("V5.5 host: #root missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
