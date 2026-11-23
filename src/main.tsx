import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./index.css";
import "./i18n";

// The window is created hidden (tauri.conf.json) so the user never sees an
// empty white frame. The splash in index.html is already painted by now.
if (isTauri()) {
  requestAnimationFrame(() => void getCurrentWindow().show());
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Two frames: one for React's commit, one so the app is on screen before the
// splash starts fading.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    const splash = document.getElementById("splash");
    if (!splash) return;
    splash.classList.add("done");
    splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 400);
  })
);
