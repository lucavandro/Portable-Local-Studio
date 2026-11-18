import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import TopStatusBar from "./components/TopStatusBar";
import ModelManager from "./components/ModelManager";
import Settings from "./components/Settings";
import TextChat from "./components/TextChat";
import SpeechTranscriber from "./components/SpeechTranscriber";
import TextToSpeech from "./components/TextToSpeech";
import {
  getDiagnostics,
  getHardwareSpecs,
  getHealth,
  getTelemetry,
  listLlmConversations,
  saveLlmConversation,
  deleteLlmConversation,
  listSpeechTranscriptions,
  deleteSpeechTranscription,
  listTtsOutputs,
  deleteTtsOutput,
} from "./services/api";
import "./App.css";

// Screens live in the URL hash (#/chat, #/chat/<id>, #/voice, ...) so a refresh
// reopens the same screen and the browser's back/forward buttons work.
const ROUTE_TO_TAB = {
  chat: "chat",
  transcribe: "speech",
  voice: "tts",
  models: "models",
  settings: "settings",
};
const TAB_TO_ROUTE = Object.fromEntries(
  Object.entries(ROUTE_TO_TAB).map(([route, tab]) => [tab, route]),
);

function readRoute() {
  const [route, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  const tab = ROUTE_TO_TAB[route] || "chat";
  const conversationId = tab === "chat" && id ? decodeURIComponent(id) : null;
  return { tab, conversationId };
}

function routeHash(tab, conversationId) {
  const route = TAB_TO_ROUTE[tab] || "chat";
  return tab === "chat" && conversationId
    ? `#/${route}/${encodeURIComponent(conversationId)}`
    : `#/${route}`;
}

function App() {
  const dialogResolverRef = useRef(null);
  const [dialog, setDialog] = useState(null);

  const closeDialog = useCallback((value) => {
    const resolver = dialogResolverRef.current;
    dialogResolverRef.current = null;
    setDialog(null);
    if (resolver) resolver(value);
  }, []);

  const showConfirm = useCallback(
    ({
      title = "Confirm Action",
      message,
      confirmLabel = "OK",
      cancelLabel = "Cancel",
      danger = false,
    }) => {
      return new Promise((resolve) => {
        dialogResolverRef.current = resolve;
        setDialog({
          type: "confirm",
          title,
          message,
          confirmLabel,
          cancelLabel,
          danger,
        });
      });
    },
    [],
  );

  const showAlert = useCallback(
    ({ title = "Notice", message, confirmLabel = "OK", danger = false }) => {
      return new Promise((resolve) => {
        dialogResolverRef.current = resolve;
        setDialog({ type: "alert", title, message, confirmLabel, danger });
      });
    },
    [],
  );

  // Theme State
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Navigation
  const [activeTab, setActiveTab] = useState(() => readRoute().tab);

  const [isLlmLoaded, setIsLlmLoaded] = useState(false);
  const [health, setHealth] = useState(null);
  const [isReadinessBusy, setIsReadinessBusy] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  // System Specifications & Telemetry
  const [specs, setSpecs] = useState({
    os_name: "Loading Specs...",
    cpu_name: "Loading Specs...",
    cpu_cores_physical: 4,
    cpu_cores_logical: 8,
    ram_total_gb: 0,
    gpu_name: "Loading Specs...",
  });

  const [telemetry, setTelemetry] = useState({
    cpu_usage: 0,
    ram_used_gb: 0,
    ram_total_gb: 0,
    gpu_name: "Detecting...",
    vram_used_gb: 0,
    vram_total_gb: 0,
  });

  const [textSettings, setTextSettings] = useState(() => {
    const saved = localStorage.getItem("textSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          contextSize: Math.min(2048, Number(parsed.contextSize) || 2048),
          gpuLayers: 0,
          preferredBackend: "cpu",
          mlock: false,
          enableThinking: false,
          maxTokens: Math.min(512, Number(parsed.maxTokens) || 384),
          responseTokenMode: "manual",
        };
      } catch (_) {}
    }
    return {
      contextSize: 2048,
      temperature: 0.7,
      systemPrompt:
        "Sei un assistente per un laboratorio scolastico di intelligenza artificiale. Rispondi in italiano in modo breve e chiaro. Se non conosci una risposta, dichiaralo.",
      threads: Math.max(
        1,
        Math.min(4, (navigator.hardwareConcurrency || 4) - 1),
      ),
      enableThinking: false,
      // New performance settings
      gpuLayers: 0,
      maxTokens: 384,
      responseTokenMode: "manual",
      topP: 0.95,
      topK: 40,
      minP: 0.05,
      repeatPenalty: 1.1,
      seed: null,
      performanceProfile: "balanced",
      flashAttn: true,
      cacheTypeK: "q8_0",
      cacheTypeV: "q8_0",
      mlock: false,
      mmap: true,
      cachePrompt: true,
      defragThold: 0.1,
      batchSize: 128,
      ubatchSize: 128,
      preferredBackend: "cpu",
    };
  });

  useEffect(() => {
    localStorage.setItem("textSettings", JSON.stringify(textSettings));
  }, [textSettings]);

  const [speechSettings, setSpeechSettings] = useState(() => {
    const saved = localStorage.getItem("speechSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          language: parsed.language || "auto",
          threads: Math.max(
            1,
            Math.min(
              32,
              Number(parsed.threads) ||
                Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4)),
            ),
          ),
          backendPreference: "cpu",
          translate: parsed.translate === true,
        };
      } catch (_) {}
    }
    return {
      language: "it",
      threads: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4)),
      backendPreference: "cpu",
      translate: false,
    };
  });

  useEffect(() => {
    localStorage.setItem("speechSettings", JSON.stringify(speechSettings));
  }, [speechSettings]);

  const [ttsSettings, setTtsSettings] = useState(() => {
    const saved = localStorage.getItem("ttsSettings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          model: parsed.model || "",
          voice: parsed.voice || "af_heart",
          speed: Math.max(0.5, Math.min(2, Number(parsed.speed) || 1)),
        };
      } catch (_) {}
    }
    return {
      model: "",
      voice: "af_heart",
      speed: 1,
    };
  });

  useEffect(() => {
    localStorage.setItem("ttsSettings", JSON.stringify(ttsSettings));
  }, [ttsSettings]);

  // Lifted Chat History States
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(
    () => readRoute().conversationId,
  );

  // Keep the URL in step with the screen; the first sync replaces the entry so the
  // initial load doesn't add an extra back-button step
  useEffect(() => {
    const hash = routeHash(activeTab, activeConversationId);
    if (window.location.hash === hash) return;
    if (!window.location.hash) {
      window.history.replaceState(null, "", hash);
    } else {
      window.location.hash = hash;
    }
  }, [activeTab, activeConversationId]);

  useEffect(() => {
    const handleHashChange = () => {
      const { tab, conversationId } = readRoute();
      setActiveTab(tab);
      if (tab === "chat") setActiveConversationId(conversationId);
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    const saved = localStorage.getItem("sidebarVisible");
    return saved !== "false";
  });

  useEffect(() => {
    localStorage.setItem("sidebarVisible", String(sidebarVisible));
  }, [sidebarVisible]);

  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("fontSize");
    return saved ? Number(saved) : 16;
  });

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-font-size",
      `${fontSize}px`,
    );
    localStorage.setItem("fontSize", String(fontSize));
  }, [fontSize]);
  const [speechTranscriptions, setSpeechTranscriptions] = useState([]);
  const [selectedSpeechTranscript, setSelectedSpeechTranscript] =
    useState(null);
  const [ttsOutputs, setTtsOutputs] = useState([]);
  const [selectedTtsOutput, setSelectedTtsOutput] = useState(null);

  const sanitizeMessageForStorage = (message) => {
    if (!Array.isArray(message?.content)) return message;
    return {
      ...message,
      content: message.content.map((item) => {
        if (item?.type !== "image_url") return item;
        return {
          type: "text",
          text: "[Attached image omitted from saved chat history]",
        };
      }),
    };
  };

  const sanitizeConversationForStorage = (conversation) => ({
    ...conversation,
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map(sanitizeMessageForStorage)
      : [],
  });

  const persistConversation = (conversation) => {
    const compactConversation = sanitizeConversationForStorage(conversation);
    try {
      saveLlmConversation(compactConversation).catch((err) => {
        console.warn("Could not save chat history to app folder:", err);
      });
    } catch (err) {
      console.warn("Could not save chat history:", err);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function loadConversations() {
      let legacyConversations = [];
      const legacySaved = localStorage.getItem("chat_conversations");
      if (legacySaved) {
        try {
          legacyConversations = JSON.parse(legacySaved);
        } catch (_) {
          localStorage.removeItem("chat_conversations");
        }
      }

      try {
        const diskConversations = await listLlmConversations();
        const diskIds = new Set(
          diskConversations.map((conversation) => conversation.id),
        );
        const missingLegacy = legacyConversations
          .map(sanitizeConversationForStorage)
          .filter(
            (conversation) => conversation.id && !diskIds.has(conversation.id),
          );

        if (missingLegacy.length > 0) {
          await Promise.all(
            missingLegacy.map((conversation) =>
              saveLlmConversation(conversation),
            ),
          );
        }

        const merged = [...diskConversations, ...missingLegacy].sort(
          (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0),
        );
        if (!cancelled) setConversations(merged);
        if (legacySaved) localStorage.removeItem("chat_conversations");
      } catch (err) {
        console.warn("Could not load chat history from app folder:", err);
        if (!cancelled && legacyConversations.length > 0) {
          setConversations(
            legacyConversations.map(sanitizeConversationForStorage),
          );
        }
      }
    }
    loadConversations();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveConversationState = useCallback(
    (id, msgs, modelName, newTitle = null) => {
      setConversations((prev) => {
        const list = [...prev];
        const idx = list.findIndex((c) => c.id === id);
        let conversation;
        if (idx !== -1) {
          conversation = {
            ...list[idx],
            messages: msgs,
            timestamp: Date.now(),
            model: modelName,
            ...(newTitle ? { title: newTitle } : {}),
          };
          list[idx] = conversation;
        } else {
          conversation = {
            id,
            title: newTitle || "Chat Session",
            model: modelName,
            messages: msgs,
            timestamp: Date.now(),
          };
          list.unshift(conversation);
        }
        persistConversation(conversation);
        return list;
      });
    },
    [],
  );

  const handleDeleteConversation = useCallback(
    (id, e) => {
      if (e) e.stopPropagation();
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== id);
        return filtered;
      });
      deleteLlmConversation(id).catch((err) => {
        console.warn("Could not delete chat history from app folder:", err);
      });
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
    },
    [activeConversationId],
  );

  const refreshSpeechTranscriptions = useCallback(async () => {
    try {
      const list = await listSpeechTranscriptions();
      setSpeechTranscriptions(list);
    } catch (err) {
      console.warn("Could not load speech transcriptions:", err);
      setSpeechTranscriptions([]);
    }
  }, []);

  const handleDeleteSpeechTranscription = useCallback(
    async (item, e) => {
      if (e) e.stopPropagation();
      const itemId = item.filename || item.metadata || item.textFile;
      if (!itemId) return;

      const ok = await showConfirm({
        title: "Delete Transcription",
        message: `Are you sure you want to delete "${item.displayName || item.sourceFilename || "this transcription"}"? This action cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;

      try {
        await deleteSpeechTranscription(itemId);

        setSelectedSpeechTranscript((prev) => {
          if (prev) {
            const prevId = prev.filename || prev.metadata || prev.textFile;
            if (prevId === itemId) return null;
          }
          return prev;
        });

        refreshSpeechTranscriptions();
      } catch (err) {
        console.error("Failed to delete speech transcription:", err);
        showAlert({
          title: "Delete Failed",
          message: err.message || String(err),
          danger: true,
        });
      }
    },
    [
      showConfirm,
      showAlert,
      setSelectedSpeechTranscript,
      refreshSpeechTranscriptions,
    ],
  );

  useEffect(() => {
    refreshSpeechTranscriptions();
  }, [refreshSpeechTranscriptions]);

  const refreshTtsOutputs = useCallback(async () => {
    try {
      const list = await listTtsOutputs();
      setTtsOutputs(list);
    } catch (err) {
      console.warn("Could not load TTS outputs:", err);
      setTtsOutputs([]);
    }
  }, []);

  const handleDeleteTtsOutput = useCallback(
    async (item, e) => {
      if (e) e.stopPropagation();
      const itemId = item.filename || item.metadata;
      if (!itemId) return;

      const ok = await showConfirm({
        title: "Delete TTS Output",
        message: `Are you sure you want to delete "${item.displayName || item.audioFile || "this audio"}"? This action cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;

      try {
        await deleteTtsOutput(itemId);
        setSelectedTtsOutput((prev) => {
          if (prev) {
            const prevId = prev.filename || prev.metadata;
            if (prevId === itemId) return null;
          }
          return prev;
        });
        refreshTtsOutputs();
      } catch (err) {
        console.error("Failed to delete TTS output:", err);
        showAlert({
          title: "Delete Failed",
          message: err.message || String(err),
          danger: true,
        });
      }
    },
    [showConfirm, showAlert, refreshTtsOutputs],
  );

  useEffect(() => {
    refreshTtsOutputs();
  }, [refreshTtsOutputs]);

  // Load hardware specifications on mount
  useEffect(() => {
    async function loadSpecs() {
      try {
        const hardware = await getHardwareSpecs();
        setSpecs(hardware);
        setTextSettings((prev) => ({
          ...prev,
          threads: Math.max(
            1,
            Math.min(4, hardware.cpu_cores_physical - 1 || 1),
          ),
        }));
      } catch (err) {
        console.error("Error fetching hardware specs:", err);
      }
    }
    loadSpecs();
  }, []);

  const refreshReadiness = useCallback(async () => {
    setIsReadinessBusy(true);
    try {
      const healthInfo = await getHealth();
      setHealth(healthInfo);
    } finally {
      setIsReadinessBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshReadiness();
  }, [refreshReadiness]);

  const copyDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await getDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 1800);
    } catch (err) {
      showAlert({
        title: "Diagnostics Failed",
        message: err.message || String(err),
        danger: true,
      });
    }
  }, [showAlert]);

  // Poll system telemetry usage statistics on interval
  useEffect(() => {
    async function updateTelemetry() {
      try {
        const stats = await getTelemetry();
        setTelemetry((prev) =>
          prev.cpu_usage === stats.cpu_usage &&
          prev.ram_used_gb === stats.ram_used_gb &&
          prev.ram_total_gb === stats.ram_total_gb &&
          prev.gpu_name === stats.gpu_name &&
          prev.vram_used_gb === stats.vram_used_gb &&
          prev.vram_total_gb === stats.vram_total_gb
            ? prev
            : stats,
        );
      } catch (err) {
        // Telemetry errors ignored
      }
    }

    updateTelemetry();
    const interval = setInterval(updateTelemetry, 1500); // Poll every 1.5 seconds

    return () => clearInterval(interval);
  }, []);

  // Tab contents are kept mounted to preserve loading/generation state when switching tabs

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setActiveTab("chat");
  }, []);

  const toggleSidebar = useCallback(
    () => setSidebarVisible((visible) => !visible),
    [],
  );

  // The top bar only shows outside a running conversation, so chats get the full height
  const [chatInThread, setChatInThread] = useState(false);
  const showTopBar = !(activeTab === "chat" && chatInThread);

  const sidebarContent = useMemo(
    () => (
      <Sidebar
        collapsed={!sidebarVisible}
        onToggleSidebar={toggleSidebar}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        specs={specs}
        telemetry={telemetry}
        onNewChat={handleNewChat}
        conversations={conversations}
        activeConversationId={activeConversationId}
        setActiveConversationId={setActiveConversationId}
        onDeleteConversation={handleDeleteConversation}
        speechTranscriptions={speechTranscriptions}
        selectedSpeechTranscript={selectedSpeechTranscript}
        setSelectedSpeechTranscript={setSelectedSpeechTranscript}
        onDeleteSpeechTranscription={handleDeleteSpeechTranscription}
      />
    ),
    [
      sidebarVisible,
      toggleSidebar,
      activeTab,
      specs,
      telemetry,
      handleNewChat,
      conversations,
      activeConversationId,
      handleDeleteConversation,
      speechTranscriptions,
      selectedSpeechTranscript,
      handleDeleteSpeechTranscription,
    ],
  );

  const handleTextUnloaded = useCallback(() => setIsLlmLoaded(false), []);

  return (
    <div className="app-container">
      {/* Sidebar with Navigation Rail & Specs */}
      {sidebarContent}

      {/* Main Panel */}
      <div className="main-content">
        {/* Top telemetry specs chips bar */}
        {showTopBar && (
          <TopStatusBar
            onTextUnloaded={handleTextUnloaded}
            theme={theme}
            setTheme={setTheme}
            sidebarVisible={sidebarVisible}
            onToggleSidebar={toggleSidebar}
          />
        )}

        {/* Dynamic Workspace Container */}
        <div
          style={{
            display: activeTab === "models" ? "flex" : "none",
            flex: 1,
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <ModelManager
            telemetry={telemetry}
            showAlert={showAlert}
            showConfirm={showConfirm}
            activeTab={activeTab}
            specs={specs}
            textSettings={textSettings}
          />
        </div>

        <div
          style={{
            display: activeTab === "chat" ? "flex" : "none",
            flex: 1,
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <TextChat
            specs={specs}
            showAlert={showAlert}
            showConfirm={showConfirm}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
            conversations={conversations}
            setConversations={setConversations}
            activeConversationId={activeConversationId}
            setActiveConversationId={setActiveConversationId}
            saveConversationState={saveConversationState}
            setIsLlmLoaded={setIsLlmLoaded}
            setActiveTab={setActiveTab}
            onThreadChange={setChatInThread}
            sidebarVisible={sidebarVisible}
            onToggleSidebar={toggleSidebar}
          />
        </div>

        <div
          style={{
            display: activeTab === "speech" ? "flex" : "none",
            flex: 1,
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <SpeechTranscriber
            showAlert={showAlert}
            showConfirm={showConfirm}
            selectedTranscript={selectedSpeechTranscript}
            onTranscriptionsChanged={refreshSpeechTranscriptions}
            speechSettings={speechSettings}
            setSpeechSettings={setSpeechSettings}
          />
        </div>

        <div
          style={{
            display: activeTab === "tts" ? "flex" : "none",
            flex: 1,
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <TextToSpeech
            showAlert={showAlert}
            showConfirm={showConfirm}
            selectedOutput={selectedTtsOutput}
            onOutputsChanged={refreshTtsOutputs}
            outputs={ttsOutputs}
            onDeleteOutput={handleDeleteTtsOutput}
            ttsSettings={ttsSettings}
            setTtsSettings={setTtsSettings}
          />
        </div>

        <div
          style={{
            display: activeTab === "settings" ? "flex" : "none",
            flex: 1,
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Settings
            specs={specs}
            showAlert={showAlert}
            showConfirm={showConfirm}
            textSettings={textSettings}
            setTextSettings={setTextSettings}
            speechSettings={speechSettings}
            setSpeechSettings={setSpeechSettings}
            ttsSettings={ttsSettings}
            setTtsSettings={setTtsSettings}
            health={health}
            isReadinessBusy={isReadinessBusy}
            refreshReadiness={refreshReadiness}
            copyDiagnostics={copyDiagnostics}
            diagnosticsCopied={diagnosticsCopied}
            theme={theme}
            setTheme={setTheme}
            fontSize={fontSize}
            setFontSize={setFontSize}
          />
        </div>
      </div>

      {dialog && (
        <div className="app-dialog-backdrop" role="presentation">
          <div
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
          >
            <h3 id="app-dialog-title" className="app-dialog-title">
              {dialog.title}
            </h3>
            <p className="app-dialog-message">{dialog.message}</p>
            <div className="app-dialog-actions">
              {dialog.type === "confirm" && (
                <button
                  className="m3-btn m3-btn-outlined"
                  onClick={() => closeDialog(false)}
                >
                  {dialog.cancelLabel}
                </button>
              )}
              <button
                className={`m3-btn ${dialog.danger ? "m3-btn-error" : "m3-btn-filled"}`}
                onClick={() => closeDialog(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
