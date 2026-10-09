import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/AppShell";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element in web/index.html");

createRoot(container).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
