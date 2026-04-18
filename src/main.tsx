import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";

// Clean up legacy localStorage from earlier client-side persistence model.
// Backend is now the source of truth for tasks & config.
try {
  localStorage.removeItem("hermes-researcher");
  localStorage.removeItem("hermes-config");
} catch {
  /* ignore */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
