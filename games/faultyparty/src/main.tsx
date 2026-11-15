import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// The RookieGamers SDK is loaded by index.html. Outside the portal it's absent and the game still runs.
async function start() {
  try {
    await window.rg?.init({ game: "faultyparty" });
  } catch {
    // Playing without the portal (local dev): sharing falls back to the X intent.
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
start();
