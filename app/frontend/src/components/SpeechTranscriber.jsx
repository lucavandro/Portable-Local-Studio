import { describeUiError } from "../utils/uiError";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  FileAudio,
  Languages,
  LoaderCircle,
  Mic,
  RefreshCw,
  SlidersHorizontal,
  Square,
  Upload,
  X,
} from "lucide-react";
import {
  getSpeechStatus,
  listSpeechModels,
  startSpeech,
  stopSpeech,
  transcribeSpeech,
} from "../services/api";
import {
  createMicRecorder,
  encodeWavPcm16,
  resampleLinear,
} from "../utils/audio";
import "../styles/transcribe.css";

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Rilevamento automatico" },
  { value: "en", label: "Inglese" },
  { value: "es", label: "Spagnolo" },
  { value: "fr", label: "Francese" },
  { value: "de", label: "Tedesco" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Portoghese" },
  { value: "hi", label: "Hindi" },
  { value: "ja", label: "Giapponese" },
  { value: "ko", label: "Coreano" },
  { value: "zh", label: "Cinese" },
];

// Whisper only needs 16 kHz mono, so any format the browser can decode (MP3, M4A, OGG,
// WebM, FLAC, MP4, WAV) is converted here before upload. This also shrinks long WAV
// recordings: an hour of 16 kHz mono PCM is about 115 MB.
async function convertAudioFileTo16kWav(file) {
  const encoded = await file.arrayBuffer();
  // An OfflineAudioContext at 16 kHz makes decodeAudioData resample while decoding.
  const decoder = new OfflineAudioContext(1, 16000, 16000);
  let decoded;
  try {
    decoded = await decoder.decodeAudioData(encoded);
  } catch (_) {
    throw new Error(
      `Impossibile leggere "${file.name}". Sono supportati i formati riproducibili dal browser, come WAV, MP3, M4A, OGG, WebM e FLAC.`,
    );
  }
  const mono = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1)
      mono[i] += data[i] / decoded.numberOfChannels;
  }
  const samples =
    decoded.sampleRate === 16000
      ? mono
      : resampleLinear(mono, decoded.sampleRate, 16000);
  return encodeWavPcm16(samples, 16000);
}

function downloadBlob(filename, content, type) {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeTimestamp(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const from = value.match(/from=([^;},]+)/)?.[1];
    const to = value.match(/to=([^;},]+)/)?.[1];
    return from && to ? `${from} - ${to}` : value;
  }
  if (typeof value === "object" && value.from && value.to) {
    return `${value.from} - ${value.to}`;
  }
  return "";
}

function formatTranscriptText(transcription, showTimestamps) {
  const segments = transcription?.raw?.transcription;
  if (!Array.isArray(segments) || segments.length === 0) {
    return transcription?.text || "";
  }
  return segments
    .map((segment) => {
      const text = String(segment.text || "").trim();
      if (!showTimestamps) return text;
      const time = normalizeTimestamp(segment.timestamps);
      return time ? `[${time}] ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

// Every clip handed to setCurrentAudio is 16 kHz mono PCM16 WAV (44-byte header).
function wavDurationSeconds(blob) {
  if (!blob?.size) return 0;
  return Math.max(0, blob.size - 44) / (16000 * 2);
}

function stripExtension(name) {
  return String(name || "").replace(/\.[^.\/\\]+$/, "");
}

export default function SpeechTranscriber({
  showAlert,
  showConfirm,
  selectedTranscript,
  onTranscriptionsChanged,
  speechSettings,
  setSpeechSettings,
}) {
  const [status, setStatus] = useState({
    ready: false,
    running: false,
    backendInstalled: false,
    settings: {},
  });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");

  const language = speechSettings?.language || "auto";
  const threads = speechSettings?.threads || 4;
  const backendPreference = "cpu";
  const translate = speechSettings?.translate === true;

  const setLanguage = (val) =>
    setSpeechSettings((prev) => ({ ...prev, language: val }));
  const setThreads = (val) =>
    setSpeechSettings((prev) => ({ ...prev, threads: val }));
  const setTranslate = (val) =>
    setSpeechSettings((prev) => ({ ...prev, translate: val }));

  const [audioBlob, setAudioBlob] = useState(null);
  const [audioName, setAudioName] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isConvertingAudio, setIsConvertingAudio] = useState(false);
  const [result, setResult] = useState(null);
  const [resultText, setResultText] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [transcribedBlob, setTranscribedBlob] = useState(null);
  const recorderRef = useRef(null);
  const abortRef = useRef(null);
  const modelMenuRef = useRef(null);
  const optionsRef = useRef(null);
  const dragDepthRef = useRef(0);

  const installedModels = useMemo(
    () => models.filter((model) => model.installed),
    [models],
  );
  const isSelectedRuntimeLoaded =
    status.ready &&
    status.settings?.model === selectedModel &&
    (status.settings?.backendPreference || "auto") === backendPreference;

  const isEnglishOnly = useMemo(() => {
    if (!selectedModel) return false;
    const model = models.find((m) => m.filename === selectedModel);
    return (
      ["English", "Inglese"].includes(model?.language) ||
      selectedModel.toLowerCase().includes(".en")
    );
  }, [selectedModel, models]);

  const refresh = useCallback(async () => {
    const [nextStatus, nextModels] = await Promise.all([
      getSpeechStatus(),
      listSpeechModels(),
    ]);
    setStatus(nextStatus);
    setModels(nextModels);
    setSelectedModel((current) => {
      const installed = nextModels.filter((model) => model.installed);
      if (
        current &&
        installed.some(
          (model) => model.filename === current || model.id === current,
        )
      )
        return current;
      const active = nextStatus.settings?.model;
      if (active && installed.some((model) => model.filename === active))
        return active;
      return (
        installed.find((model) => model.recommended)?.filename ||
        installed[0]?.filename ||
        ""
      );
    });
  }, []);

  useEffect(() => {
    refresh().catch((err) =>
      showAlert?.({
        title: "Stato della trascrizione non disponibile",
        message: describeUiError(err),
        danger: true,
      }),
    );
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [refresh, showAlert]);

  useEffect(() => {
    if (!selectedTranscript) return;
    setResult(selectedTranscript);
  }, [selectedTranscript]);

  useEffect(() => {
    if (!result) return;
    setResultText(formatTranscriptText(result, showTimestamps));
  }, [result, showTimestamps]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      abortRef.current?.abort();
    };
  }, [audioUrl]);

  // Elapsed time while the microphone is recording.
  useEffect(() => {
    if (!isRecording) return undefined;
    const startedAt = Date.now();
    setRecordingSeconds(0);
    const timer = setInterval(
      () => setRecordingSeconds((Date.now() - startedAt) / 1000),
      250,
    );
    return () => clearInterval(timer);
  }, [isRecording]);

  // Close the model menu and options popover on outside click or Escape.
  useEffect(() => {
    function handleClickOutside(event) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target))
        setShowModelMenu(false);
      if (optionsRef.current && !optionsRef.current.contains(event.target))
        setShowOptions(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setShowModelMenu(false);
        setShowOptions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const setCurrentAudio = useCallback((blob, name) => {
    setAudioBlob(blob);
    setAudioName(name);
    setResult(null);
    setResultText("");
    setAudioUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return URL.createObjectURL(blob);
    });
  }, []);

  const clearCurrentAudio = useCallback(() => {
    setAudioBlob(null);
    setAudioName("");
    setAudioUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return "";
    });
  }, []);

  // Loads the given Whisper model (defaults to the selected one), same as the old Load button.
  const handleLoadSpeechModel = async (filename = selectedModel) => {
    if (!filename) return;
    setSelectedModel(filename);
    const alreadyLoaded =
      status.ready &&
      status.settings?.model === filename &&
      (status.settings?.backendPreference || "auto") === backendPreference;
    setIsLoadingModel(true);
    try {
      if (!alreadyLoaded) {
        await startSpeech(filename, { language, threads, backendPreference });
      }
      await refresh();
    } catch (err) {
      showAlert?.({
        title: "Caricamento del modello di trascrizione non riuscito",
        message: describeUiError(err),
        danger: true,
      });
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleStopRuntime = () => {
    stopSpeech()
      .then(refresh)
      .catch((err) =>
        showAlert?.({
          title: "Impossibile arrestare il motore",
          message: describeUiError(err),
          danger: true,
        }),
      );
  };

  const handleRefresh = () => {
    refresh().catch((err) =>
      showAlert?.({
        title: "Stato della trascrizione non disponibile",
        message: describeUiError(err),
        danger: true,
      }),
    );
  };

  const startRecording = async () => {
    try {
      recorderRef.current = await createMicRecorder();
      setIsRecording(true);
    } catch (err) {
      showAlert?.({
        title: "Microfono non disponibile",
        message: describeUiError(err),
        danger: true,
      });
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setIsRecording(false);
    const wav = await recorder.stop();
    setCurrentAudio(
      wav,
      `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`,
    );
  };

  // Shared by the Upload button and drag-and-drop.
  const handleAudioFile = async (file) => {
    if (!file) return;
    setIsConvertingAudio(true);
    try {
      const wav = await convertAudioFileTo16kWav(file);
      setCurrentAudio(wav, file.name.replace(/\.[^.]+$/, "") + ".wav");
    } catch (err) {
      showAlert?.({
        title: "Audio non supportato",
        message: describeUiError(err),
        danger: true,
      });
    } finally {
      setIsConvertingAudio(false);
    }
  };

  const handleUploadAudio = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    await handleAudioFile(file);
  };

  const dropDisabled = isConvertingAudio || isTranscribing || isRecording;

  const handleDragEnter = (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    if (!dropDisabled) setIsDragging(true);
  };

  const handleDragOver = (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dropDisabled ? "none" : "copy";
  };

  const handleDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (dropDisabled) return;
    const file = event.dataTransfer?.files?.[0];
    handleAudioFile(file);
  };

  const handleTranscribe = async () => {
    if (!audioBlob || !selectedModel) return;
    setIsTranscribing(true);
    setResult(null);
    setResultText("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (!isSelectedRuntimeLoaded) {
        setIsLoadingModel(true);
        try {
          await startSpeech(selectedModel, {
            language,
            threads,
            backendPreference,
          });
          await refresh();
        } finally {
          setIsLoadingModel(false);
        }
      }
      const transcription = await transcribeSpeech(audioBlob, {
        model: selectedModel,
        language,
        threads,
        backendPreference,
        translate,
        filename: audioName || "audio.wav",
        signal: controller.signal,
      });
      setResult(transcription);
      setTranscribedBlob(audioBlob);
      await refresh();
      await onTranscriptionsChanged?.();

      if (transcription?.text?.toLowerCase().includes("foreign language")) {
        showAlert?.({
          title: "Rilevata una lingua diversa dall’inglese",
          message:
            "Il modello caricato riconosce solo l’inglese. Scarica un modello Whisper multilingue dalla pagina Modelli, caricalo e riprova la trascrizione.",
          danger: false,
        });
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        showAlert?.({
          title: "Trascrizione non riuscita",
          message: describeUiError(err),
          danger: true,
        });
      }
    } finally {
      abortRef.current = null;
      setIsTranscribing(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsTranscribing(false);
  };

  const saveText = () => {
    if (!resultText.trim()) return;
    downloadBlob("transcription.txt", resultText, "text/plain;charset=utf-8");
  };

  const saveJson = () => {
    const payload = { ...(result || {}), text: resultText };
    downloadBlob(
      "transcription.json",
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
    );
  };

  const copyText = async () => {
    if (!resultText.trim()) return;
    try {
      await navigator.clipboard.writeText(resultText);
      setCopied(true);
    } catch (err) {
      showAlert?.({
        title: "Impossibile copiare",
        message: describeUiError(err),
        danger: true,
      });
    }
  };

  const selectedModelInfo = installedModels.find(
    (model) => model.filename === selectedModel,
  );
  const modelLabel =
    selectedModelInfo?.name ||
    selectedModel ||
    (installedModels.length ? "Scegli un modello Whisper" : "Nessun modello Whisper");
  const segments = Array.isArray(result?.raw?.transcription)
    ? result.raw.transcription
    : [];
  const hasSegments = segments.length > 0;
  const transcriptTitle =
    stripExtension(
      result?.displayName ||
        result?.sourceFilename ||
        result?.textFile ||
        result?.filename ||
        audioName,
    ) || "Trascrizione";
  const runtimeLabel = status.backendInstalled
    ? status.ready
      ? "Pronto"
      : "Installato"
    : "Motore non installato";
  const languageLabel =
    LANGUAGE_OPTIONS.find((item) => item.value === language)?.label ||
    "Rilevamento automatico";
  const audioDuration = wavDurationSeconds(audioBlob);

  const modelPicker = (
    <div ref={modelMenuRef} className="chat-model-picker">
      <button
        type="button"
        onClick={() => setShowModelMenu((open) => !open)}
        className={`chat-model-trigger ${showModelMenu ? "active" : ""}`}
        disabled={isTranscribing}
        aria-haspopup="menu"
        aria-expanded={showModelMenu}
        title={selectedModel || "Scegli un modello Whisper"}
      >
        {isLoadingModel ? (
          <LoaderCircle
            size={14}
            className="transcribe-spin"
            aria-hidden="true"
          />
        ) : (
          isSelectedRuntimeLoaded && (
            <span className="chat-model-dot" aria-hidden="true" />
          )
        )}
        <span className="chat-model-trigger-label">{modelLabel}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {showModelMenu && (
        <div className="chat-model-menu" role="menu">
          <div className="chat-model-menu-label">Modelli Whisper</div>
          {installedModels.length === 0 && (
            <div className="chat-model-menu-label transcribe-menu-note">
              Scarica un modello in Modelli → Trascrizione.
            </div>
          )}
          {installedModels.map((model) => {
            const isActive =
              status.ready && status.settings?.model === model.filename;
            return (
              <button
                type="button"
                role="menuitem"
                key={model.id || model.filename}
                className={`chat-model-menu-item ${model.filename === selectedModel ? "selected" : ""}`}
                onClick={() => {
                  setShowModelMenu(false);
                  handleLoadSpeechModel(model.filename);
                }}
                disabled={isLoadingModel}
                title={model.filename}
              >
                <span className="chat-model-menu-name">
                  {model.name || model.filename}
                </span>
                {isActive && (
                  <span className="chat-model-menu-badge">Caricato</span>
                )}
              </button>
            );
          })}
          <div className="chat-model-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="chat-model-menu-item"
            onClick={() => {
              setShowModelMenu(false);
              handleRefresh();
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span className="chat-model-menu-name">Aggiorna elenco</span>
          </button>
          {status.ready && (
            <button
              type="button"
              role="menuitem"
              className="chat-model-menu-item"
              onClick={() => {
                setShowModelMenu(false);
                handleStopRuntime();
              }}
            >
              <Square size={14} aria-hidden="true" />
              <span className="chat-model-menu-name">Libera il modello dalla memoria</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  const optionsPopover = (
    <div ref={optionsRef} className="transcribe-options">
      <button
        type="button"
        className={`icon-btn ${showOptions ? "active" : ""}`}
        onClick={() => setShowOptions((open) => !open)}
        aria-label="Opzioni del motore"
        title="Opzioni del motore"
        aria-haspopup="dialog"
        aria-expanded={showOptions}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
      </button>
      {showOptions && (
        <div
          className="popover transcribe-popover"
          role="dialog"
          aria-label="Opzioni del motore"
        >
          <div className="transcribe-popover-status">
            <span className="field-label">Motore</span>
            <span className={`tag ${status.ready ? "tag-success" : ""}`}>
              {runtimeLabel}
            </span>
          </div>

          <label className="field">
            <span className="field-label">Thread della CPU</span>
            <input
              className="transcribe-input"
              type="number"
              min="1"
              max="4"
              value={threads}
              onChange={(event) =>
                setThreads(
                  Math.max(1, Math.min(4, Number(event.target.value) || 1)),
                )
              }
            />
            <span className="field-hint">
              Numero di attività parallele della CPU usate da Whisper, da 1 a 4.
            </span>
          </label>
          {selectedModel && !isSelectedRuntimeLoaded && (
            <button
              type="button"
              className="btn transcribe-popover-action"
              onClick={() => handleLoadSpeechModel(selectedModel)}
              disabled={isLoadingModel || isTranscribing}
            >
              {isLoadingModel && (
                <LoaderCircle
                  size={14}
                  className="transcribe-spin"
                  aria-hidden="true"
                />
              )}
              {isLoadingModel ? "Caricamento" : "Carica con queste impostazioni"}
            </button>
          )}
          {status.ready && (
            <button
              type="button"
              className="btn btn-danger transcribe-popover-action"
              onClick={handleStopRuntime}
              disabled={isTranscribing}
            >
              <Square size={14} aria-hidden="true" />
              Arresta il motore
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="page transcribe-page">
      <div className="page-scroll">
        <div className="page-column">
          <header className="page-header">
            <h1 className="page-title">Trascrivi</h1>
            <div className="transcribe-header-actions">
              {modelPicker}
              {optionsPopover}
            </div>
          </header>

          {status.error && (
            <div className="text-progress error transcribe-notice">
              {status.error}
            </div>
          )}
          {installedModels.length === 0 && (
            <div className="text-progress transcribe-notice">
              Scarica un modello Whisper in Modelli → Trascrizione per iniziare a
              trascrivere.
            </div>
          )}
          {!status.backendInstalled && installedModels.length > 0 && (
            <div className="text-progress transcribe-notice">
              Il motore Whisper non è installato. Riavvia il programma di
              avvio per completare la preparazione, poi aggiorna l’elenco.
            </div>
          )}

          <section
            className={`transcribe-dropzone ${isDragging ? "dragging" : ""} ${isRecording ? "recording" : ""}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            aria-label="Registra o trascina un file audio"
          >
            {isRecording ? (
              <button
                type="button"
                className="transcribe-record-btn recording"
                onClick={stopRecording}
                aria-label="Termina la registrazione"
                title="Termina la registrazione"
              >
                <Square size={22} fill="currentColor" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className="transcribe-record-btn"
                onClick={startRecording}
                disabled={isTranscribing || isConvertingAudio}
                aria-label="Avvia la registrazione"
                title="Avvia la registrazione"
              >
                <Mic size={28} aria-hidden="true" />
              </button>
            )}

            {isRecording ? (
              <div className="transcribe-dropzone-title" aria-live="polite">
                Registrazione in corso{" "}
                <span className="transcribe-elapsed">
                  {formatClock(recordingSeconds)}
                </span>
              </div>
            ) : (
              <div className="transcribe-dropzone-title">
                {isDragging
                  ? "Rilascia per aggiungere questo audio"
                  : "Registra o carica un file audio"}
              </div>
            )}
            <div className="transcribe-dropzone-hint">
              WAV, MP3, M4A, OGG, FLAC o WebM. L’audio viene convertito
              su questo PC a 16 kHz, con un solo canale.
            </div>

            <div className="transcribe-dropzone-actions">
              {isConvertingAudio ? (
                <span className="text-progress" role="status">
                  <LoaderCircle
                    size={14}
                    className="transcribe-spin"
                    aria-hidden="true"
                  />
                  Conversione dell’audio
                </span>
              ) : (
                <label
                  className={`btn transcribe-upload ${isTranscribing || isRecording ? "disabled" : ""}`}
                >
                  <Upload size={15} aria-hidden="true" />
                  <span>Carica audio</span>
                  <input
                    type="file"
                    className="transcribe-file-input"
                    accept="audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.ogg,.opus,.flac,.webm,.mp4"
                    onChange={handleUploadAudio}
                    disabled={
                      isConvertingAudio || isTranscribing || isRecording
                    }
                  />
                </label>
              )}
            </div>

            <div className="transcribe-chips">
              <label
                className="chat-composer-chip transcribe-select-chip"
                title={
                  isEnglishOnly
                    ? "Questo modello riconosce solo l’inglese"
                    : "Lingua parlata"
                }
              >
                <Languages size={15} aria-hidden="true" />
                <span className="transcribe-chip-value" aria-hidden="true">
                  {languageLabel}
                </span>
                <ChevronDown size={14} aria-hidden="true" />
                <select
                  aria-label="Lingua parlata"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  disabled={isTranscribing}
                >
                  {LANGUAGE_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={`chat-composer-chip ${translate ? "active" : ""}`}
                aria-pressed={translate}
                onClick={() => setTranslate(!translate)}
                disabled={isTranscribing}
              >
                <ArrowRightLeft size={15} aria-hidden="true" />
                Traduci in inglese
              </button>
            </div>
          </section>

          {audioBlob && (
            <div className="row-list transcribe-pending">
              <div className="row-item">
                <FileAudio
                  size={20}
                  className="transcribe-pending-icon"
                  aria-hidden="true"
                />
                <div className="row-item-main">
                  <div className="row-item-title">
                    {audioName || "audio.wav"}
                  </div>
                  <div className="row-item-meta">
                    {formatClock(audioDuration)}
                    {isTranscribing && (
                      <span
                        className="text-progress transcribe-inline-progress"
                        role="status"
                      >
                        <LoaderCircle
                          size={13}
                          className="transcribe-spin"
                          aria-hidden="true"
                        />
                        {isLoadingModel
                          ? "Caricamento del modello"
                          : "Trascrizione su questo PC"}
                      </span>
                    )}
                  </div>
                  {audioUrl && (
                    <audio
                      className="transcribe-audio"
                      controls
                      src={audioUrl}
                    />
                  )}
                </div>
                <div className="row-item-actions">
                  {isTranscribing ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={handleCancel}
                    >
                      <Square size={13} aria-hidden="true" />
                      Annulla
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="icon-btn danger"
                        onClick={clearCurrentAudio}
                        disabled={isRecording}
                        aria-label="Rimuovi audio"
                        title="Rimuovi audio"
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleTranscribe}
                        disabled={
                          !audioBlob ||
                          !selectedModel ||
                          !status.backendInstalled
                        }
                      >
                        {transcribedBlob === audioBlob
                          ? "Trascrivi di nuovo"
                          : "Trascrivi"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {result && (
            <section className="transcribe-result" aria-label="Trascrizione">
              <div className="transcribe-result-header">
                <h2 className="transcribe-result-title" title={transcriptTitle}>
                  {transcriptTitle}
                </h2>
                <div className="transcribe-result-actions">
                  <button
                    type="button"
                    className={`chat-composer-chip transcribe-small-chip ${showTimestamps ? "active" : ""}`}
                    aria-pressed={showTimestamps}
                    onClick={() => setShowTimestamps(!showTimestamps)}
                    disabled={!hasSegments}
                    title={
                      hasSegments
                        ? "Mostra i riferimenti temporali"
                        : "Questa trascrizione non ha riferimenti temporali"
                    }
                  >
                    <Clock size={14} aria-hidden="true" />
                    Riferimenti temporali
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={copyText}
                    disabled={!resultText.trim()}
                    aria-label={copied ? "Copiato" : "Copia trascrizione"}
                    title={copied ? "Copiato" : "Copia trascrizione"}
                  >
                    {copied ? (
                      <Check size={16} aria-hidden="true" />
                    ) : (
                      <Copy size={16} aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={saveText}
                    disabled={!resultText.trim()}
                  >
                    <Download size={14} aria-hidden="true" />
                    TXT
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={saveJson}
                    disabled={!resultText.trim()}
                  >
                    <Download size={14} aria-hidden="true" />
                    JSON
                  </button>
                </div>
              </div>

              {showTimestamps && hasSegments ? (
                <ol className="transcribe-segments">
                  {segments.map((segment, index) => {
                    const text = String(segment.text || "").trim();
                    if (!text) return null;
                    const time = normalizeTimestamp(segment.timestamps);
                    return (
                      <li key={index} className="transcribe-segment">
                        <span className="transcribe-segment-time">{time}</span>
                        <span className="transcribe-segment-text">{text}</span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <textarea
                  className="transcribe-text"
                  value={resultText}
                  onChange={(event) => setResultText(event.target.value)}
                  aria-label="Testo della trascrizione"
                  placeholder="Non è stato rilevato parlato in questo audio."
                  spellCheck={false}
                />
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
