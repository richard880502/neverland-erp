"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY } from "@/lib/color-theme";

type ThemePreference = "system" | "light" | "dark";
const storageKey = THEME_STORAGE_KEY;

function applyTheme(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePreference = preference;
}

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* System preference remains available when storage is blocked. */ }
  return "system";
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => { applyTheme(readPreference()); onChange(); };
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) sync();
  };
  const onSystemChange = () => {
    if (document.documentElement.dataset.themePreference === "system") {
      applyTheme("system");
      onChange();
    }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("neverland-theme-change", onChange);
  media.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("neverland-theme-change", onChange);
    media.removeEventListener("change", onSystemChange);
  };
}

function getSnapshot() {
  return (document.documentElement.dataset.themePreference ?? "system") as ThemePreference;
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, () => "system" as ThemePreference);
  const Icon = preference === "system" ? Monitor : preference === "dark" ? Moon : Sun;
  return <label className="theme-control">
    <Icon size={15} aria-hidden="true" />
    <select aria-label="色彩模式" value={preference} onChange={(event) => {
      const next = event.target.value as ThemePreference;
      try {
        if (next === "system") localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, next);
      } catch { /* Still apply the choice for the current page. */ }
      applyTheme(next);
      window.dispatchEvent(new Event("neverland-theme-change"));
    }}>
      <option value="system">跟隨系統</option>
      <option value="light">淺色模式</option>
      <option value="dark">深色模式</option>
    </select>
  </label>;
}
