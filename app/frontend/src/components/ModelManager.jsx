import ChatModelCard, { ModelFeatures } from "./ChatModelCard";
import { describeUiError } from "../utils/uiError";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  listLlmModels,
  listSpeechModels,
  listTtsModels,
  downloadLlmModel,
  downloadSpeechModel,
  downloadTtsModel,
  importLlmModel,
  importSpeechModel,
  deleteLlmModel,
  deleteSpeechModel,
  deleteTtsModel,
  getDownloadProgress,
  cancelModelDownload,
} from "../services/api";
import "../styles/school.css";

const MODES = { text: "Chat", speech: "Trascrizione", tts: "Voce" };
export default function ModelManager({ specs, activeTab, showConfirm }) {
  const [mode, setMode] = useState("text");
  const [models, setModels] = useState({ text: [], speech: [], tts: [] });
  const [download, setDownload] = useState({ active: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const refresh = useCallback(async () => {
    const [text, speech, tts, progress] = await Promise.all([
      listLlmModels(),
      listSpeechModels(),
      listTtsModels(),
      getDownloadProgress(),
    ]);
    setModels({ text, speech, tts });
    setDownload(progress);
  }, []);
  useEffect(() => {
    if (activeTab !== "models") return;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) setError(describeUiError(err));
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeTab, refresh]);
  const action = async (operation) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (err) {
      setError(describeUiError(err));
    } finally {
      setBusy(false);
    }
  };
  const install = (model) =>
    action(() =>
      mode === "text"
        ? downloadLlmModel(model.url, model.filename)
        : mode === "speech"
          ? downloadSpeechModel(model.id)
          : downloadTtsModel(model.id),
    );
  const remove = async (model) => {
    if (
      !(await showConfirm({
        title: "Elimina modello",
        message: `Eliminare ${model.name || model.filename}? Potrai scaricarlo nuovamente.`,
        confirmLabel: "Elimina",
        cancelLabel: "Annulla",
        danger: true,
      }))
    )
      return;
    await action(() =>
      ({
        text: deleteLlmModel,
        speech: deleteSpeechModel,
        tts: deleteTtsModel,
      })[mode](model.filename),
    );
  };
  const importFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > (mode === "text" ? 4 * 1024 ** 3 : 200 * 1024 ** 2)) {
      setError(
        "File troppo grande per il profilo scolastico. Scegli un modello consigliato.",
      );
      return;
    }
    action(() => (mode === "text" ? importLlmModel : importSpeechModel)(file));
  };
  const names = new Set(models.text.map((m) => m.filename));
  const catalog =
    mode === "text"
      ? (specs.recommended_models || [])
      : models[mode].filter((m) => !m.installed);
  const installed =
    mode === "text" ? models.text : models[mode].filter((m) => m.installed);
  const locked = busy || download.active;
  return (
    <section className="school-page">
      <h1>Modelli per il laboratorio</h1>
      <p>
        Modelli gratuiti eseguiti su questo computer. Internet serve per il
        download iniziale; nessun account o chiave API.
      </p>
      <div className="school-tabs" role="group" aria-label="Tipo di modello">
        {Object.entries(MODES).map(([id, label]) => (
          <button
            key={id}
            className={`m3-btn ${mode === id ? "m3-btn-filled" : "m3-btn-outlined"}`}
            onClick={() => setMode(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "text" && (
        <p>
          Limite: 4 GiB per file. Confronta le versioni dello stesso modello:
          Q3, Q4, Q5 e Q8 indicano diversi livelli di compressione dei pesi.
          Meno bit riducono spesso il file e la memoria, ma possono ridurre la qualità;
          non garantiscono maggiore velocità. F16 conserva maggiore precisione.
          I suffissi K, M e S distinguono metodi e varianti: la dimensione effettiva
          dipende anche dall’architettura. I GiB indicano il file, non la RAM totale.
        </p>
      )}
      {mode === "speech" && (
        <p>
          Whisper Tiny e Base riconoscono anche l’italiano. Usa registrazioni
          brevi: la trascrizione avviene su CPU.
        </p>
      )}
      {mode === "tts" && (
        <p>
          Kokoro Q8 legge su CPU con voci italiane Sara e Nicola. Pesi e voci
          vengono conservati al primo utilizzo: esegui una lettura di prova
          prima di lavorare offline.
        </p>
      )}
      {(error || download.error) && (
        <p className="school-error" role="alert">
          {error || download.error}
        </p>
      )}
      {download.active && (
        <div className="school-card" role="status">
          <strong>Download: {download.filename}</strong>
          <progress
            max="100"
            value={download.progress || 0}
            aria-label="Avanzamento download"
          />
          <span>
            {Math.round(download.progress || 0)}% · {download.speed}
          </span>
          <button
            className="m3-btn m3-btn-outlined"
            onClick={() => action(cancelModelDownload)}
          >
            Annulla download
          </button>
        </div>
      )}
      <h2>Installati</h2>
      {!installed.length && (
        <p>Nessun modello installato per questa attività.</p>
      )}
      <div className="school-grid">
        {installed.map((model) => (
          <article className="school-card" key={model.filename}>
            <strong>{model.name || model.filename}</strong>
            {mode === "text" && (model.isProjector ? <span>Proiettore per interpretare immagini</span> : model.id && <ModelFeatures model={model} />)}
            {mode === "text" && model.quantization && <span>{model.quantization}</span>}
            <span>{model.localSize || model.size}</span>
            <button
              className="m3-btn m3-btn-outlined"
              disabled={locked}
              onClick={() => remove(model)}
            >
              Elimina
            </button>
          </article>
        ))}
      </div>
      <h2>Consigliati</h2>
      <div className="school-grid">
        {catalog.map((model) => mode === "text" ? (
          <ChatModelCard key={model.id || model.filename} model={model} installedNames={names} locked={locked} install={install} />
        ) : (
          <article className="school-card" key={model.filename}>
            <strong>{model.name}</strong>
            <span>{model.approxSize || model.size}</span>
            <p>{model.notes}</p>
            <button
              className="m3-btn m3-btn-filled"
              disabled={locked}
              onClick={() => install(model)}
            >
              Scarica gratuitamente
            </button>
          </article>
        ))}
      </div>
      {mode !== "tts" && (
        <div className="school-import">
          <p>
            Il docente può copiare i modelli sui PC o importarli da una
            chiavetta.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={mode === "text" ? ".gguf" : ".bin"}
            hidden
            onChange={importFile}
          />
          <button
            className="m3-btn m3-btn-outlined"
            disabled={locked}
            onClick={() => inputRef.current?.click()}
          >
            Importa file {mode === "text" ? "GGUF" : "Whisper"}
          </button>
        </div>
      )}
    </section>
  );
}
