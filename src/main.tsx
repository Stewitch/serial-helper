import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import "./index.css";
import "./i18n";

/** How long the splash stays on screen, counted from when the window appears. */
const SPLASH_MS = 1000;

const splash = document.getElementById("splash");
const splashOn = !!splash && !document.documentElement.classList.contains("no-splash");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// The window is created hidden (tauri.conf.json) so the user never sees an
// empty white frame. Two frames in, the first paint has happened.
requestAnimationFrame(() =>
  requestAnimationFrame(async () => {
    if (isTauri()) await getCurrentWindow().show();
    if (!splash) return;
    if (!splashOn) {
      splash.remove();
      return;
    }
    splash.classList.add("play");
    setTimeout(() => {
      splash.classList.add("done");
      setTimeout(() => splash.remove(), 300);
    }, SPLASH_MS);
  })
);
