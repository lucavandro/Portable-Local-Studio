import React, { memo, useState, useRef, useEffect, useCallback } from "react";
import {
  Sun,
  Moon,
  Palette,
  Check,
  PanelLeft,
  Power,
  Loader2,
} from "lucide-react";
import { THEMES } from "../themes";
import { getLlmStatus, stopLlm } from "../services/api";

// "models/Gemma-4-E4B-Q5_K_M.gguf" -> "Gemma-4-E4B-Q5_K_M"
const cleanModelName = (name) =>
  String(name || "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(safetensors|gguf|ckpt|bin)$/i, "");

const RUNTIME_LABELS = { text: "Chat" };

function TopStatusBar({
  theme,
  setTheme,
  sidebarVisible,
  onToggleSidebar,
  onTextUnloaded,
}) {
  // What the server actually has loaded, polled; the screens' own state only knows what was picked
  const [loaded, setLoaded] = useState({ text: null });
  const [unloading, setUnloading] = useState(null);

  const refreshLoaded = useCallback(async () => {
    const text = await getLlmStatus().catch(() => null);
    setLoaded({
      text: text?.ready
        ? cleanModelName(text.settings?.model) || "Modello chat"
        : null,
    });
  }, []);

  useEffect(() => {
    refreshLoaded();
    const timer = setInterval(refreshLoaded, 3000);
    return () => clearInterval(timer);
  }, [refreshLoaded]);

  const unload = async (kind) => {
    setUnloading(kind);
    try {
      await stopLlm();
      onTextUnloaded?.();
    } catch (err) {
      console.error(`Failed to unload the ${kind} model:`, err);
    } finally {
      await refreshLoaded();
      setUnloading(null);
    }
  };

  const loadedKinds = ["text"].filter((kind) => loaded[kind]);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowThemeMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isDark = (theme || "dark").startsWith("dark");

  return (
    <div className="top-status-bar">
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {!sidebarVisible && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="sidebar-toggle-btn"
            aria-label="Apri la barra laterale"
            title="Apri la barra laterale"
          >
            <PanelLeft size={18} />
          </button>
        )}

        {loadedKinds.length === 0 ? (
          <div className="current-model-info status-pill">
            <div className="status-indicator offline" />
            <span>Nessun modello caricato</span>
          </div>
        ) : (
          loadedKinds.map((kind) => (
            <div
              key={kind}
              className="current-model-info status-pill status-pill-loaded"
            >
              <div className="status-indicator" />
              <span>{RUNTIME_LABELS[kind]}</span>
              <span className="status-pill-model" title={loaded[kind]}>
                {loaded[kind]}
              </span>
              <button
                type="button"
                className="status-pill-unload"
                onClick={() => unload(kind)}
                disabled={unloading !== null}
                aria-label={`Libera ${loaded[kind]} dalla memoria`}
                title="Rimuovi il modello dalla RAM per liberare memoria"
              >
                {unloading === kind ? (
                  <Loader2
                    size={13}
                    className="status-pill-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Power size={13} aria-hidden="true" />
                )}
              </button>
            </div>
          ))
        )}
      </div>

      <div className="telemetry-group" style={{ position: "relative" }}>
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={`Passa al tema ${isDark ? "chiaro" : "scuro"}`}
          title={`Passa al tema ${isDark ? "chiaro" : "scuro"}`}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div
          ref={menuRef}
          style={{ position: "relative", display: "inline-block" }}
        >
          <button
            type="button"
            aria-label="Scegli un tema colore"
            aria-expanded={showThemeMenu}
            className={`theme-toggle-btn ${showThemeMenu ? "active" : ""}`}
            onClick={() => setShowThemeMenu(!showThemeMenu)}
            title="Scegli un tema colore personalizzato"
          >
            <Palette size={18} />
          </button>

          {showThemeMenu && (
            <div className="theme-dropdown-menu">
              <div className="theme-dropdown-header">Scegli il tema</div>
              <div className="theme-dropdown-divider"></div>
              {THEMES.map((t) => {
                const isActive = theme === t.id;
                return (
                  <button
                    key={t.id}
                    className={`theme-dropdown-item ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setTheme(t.id);
                      setShowThemeMenu(false);
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        width: "100%",
                      }}
                    >
                      <div style={{ display: "flex", gap: "2px" }}>
                        <div
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: t.primary,
                          }}
                        />
                        <div
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            background: t.secondary,
                          }}
                        />
                      </div>
                      <span className="theme-name-text">{t.name}</span>
                      {isActive && (
                        <Check
                          size={12}
                          style={{
                            marginLeft: "auto",
                            color: "var(--md-sys-color-primary)",
                          }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(TopStatusBar);
