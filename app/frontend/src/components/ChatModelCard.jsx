import ModelFit from "./ModelFit";
import { useState } from "react";

export function ModelFeatures({ model }) {
  return <div className="model-features" aria-label="Caratteristiche del modello">
    <span>{model.multimodal ? "Testo e immagini" : "Solo testo"}</span>
    <span>{model.reasoning ? "Ragionamento" : "Risposta diretta"}</span>
    <span>{model.uncensored ? "Rifiuti ridotti · Heretic/abliterato" : "Versione standard"}</span>
  </div>;
}

export default function ChatModelCard({ model, specs, telemetry, installedNames, locked, install }) {
  const versions = model.variants || [model];
  const preferred = versions.find((entry) => entry.quantization === model.preferredQuantization) || versions[0];
  const [filename, setFilename] = useState(preferred?.filename || "");
  const selected = versions.find((entry) => entry.filename === filename) || preferred;
  const installed = installedNames.has(selected?.filename);
  const projector = model.projector;
  const projectorInstalled = projector && installedNames.has(projector.filename);
  return <article className="school-card">
    <strong>{model.name}</strong>
    <ModelFeatures model={model} />
    <p>{model.notes}</p>
    <label>Quantizzazione o precisione dei pesi
      <select value={selected?.filename || ""} onChange={(event) => setFilename(event.target.value)}>
        {versions.map((entry) => <option value={entry.filename} key={entry.filename}>
          {entry.quantization || "GGUF"} · {entry.approxSize || entry.size}{installedNames.has(entry.filename) ? " · installata" : ""}
        </option>)}
      </select>
    </label>
    {selected && <>
      <span>{selected.approxSize} · {selected.sizeBytes?.toLocaleString("it-IT")} byte</span>
      <ModelFit variant={selected} model={model} specs={specs} telemetry={telemetry} />
      <button className="m3-btn m3-btn-filled" disabled={locked || installed} onClick={() => install(selected)}>
        {installed ? "Versione installata" : "Scarica questa versione"}
      </button>
    </>}
    {model.multimodal && (projector ? <>
      <p>Per interpretare immagini serve anche il proiettore compatibile ({projector.approxSize}), da aggiungere al modello. Dopo il download ricarica il modello nella chat.</p>
      <button className="m3-btn m3-btn-outlined" disabled={locked || projectorInstalled} onClick={() => install(projector)}>
        {projectorInstalled ? "Proiettore installato" : "Scarica proiettore immagini"}
      </button>
    </> : <p>Modello multimodale: proiettore compatibile non presente in questo catalogo.</p>)}
    {model.repository && <a href={`https://huggingface.co/${model.repository}`} target="_blank" rel="noreferrer">Scheda e file su Hugging Face</a>}
  </article>;
}
