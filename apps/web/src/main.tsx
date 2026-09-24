import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { resolvePageMode } from "./app/hub/pageMode";
import { PageRoot } from "./components/PageRoot";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root container '#root' was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <PageRoot mode={resolvePageMode(window.location.pathname)} />
  </StrictMode>,
);
