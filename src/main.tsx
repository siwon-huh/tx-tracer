import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { ThemeProvider } from "./theme";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./graph.css";
import "./design.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider><ThemeProvider><App /></ThemeProvider></I18nProvider>
  </React.StrictMode>,
);
