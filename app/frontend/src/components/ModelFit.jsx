import { useState } from "react";
import { estimateModelFit } from "../utils/modelFit";

const LABELS = { comfortable: "Buone possibilità", tight: "Potrebbe essere al limite", insufficient: "Probabilmente insufficiente" };
const number = (value) => value.toLocaleString("it-IT", { maximumFractionDigits: 1 });
export default function ModelFit({ variant, model, specs, telemetry }) {
  const [vision, setVision] = useState(false);
  const estimate = estimateModelFit(variant, model, specs, telemetry, vision);
  return <section className="model-fit-section" aria-label="Previsione sul PC corrente">
    <h3 className="model-fit-title">Come potrebbe girare su questo PC?</h3>
    <div className={`model-fit model-fit-${estimate.known ? estimate.level : "unknown"}`}>
    <div className="model-fit-verdict">{estimate.known ? LABELS[estimate.level] : "Dati non disponibili"}</div>
    <details>
    <summary>Maggiori dettagli</summary>
    {model.multimodal && model.projector && <label className="model-fit-checkbox"><input type="checkbox" checked={vision} onChange={(event) => setVision(event.target.checked)} />Includi interpretazione di immagini e proiettore</label>}
    <p>{specs?.cpu_name || "CPU non rilevata"} · esecuzione su CPU</p>
    {estimate.known ? <>
      <p><strong>{LABELS[estimate.level]}</strong><br />Memoria di lavoro prevista: {number(estimate.low)}–{number(estimate.high)} GiB.<br />RAM libera rilevata: {number(estimate.available)} GiB; margine aggiuntivo riservato: 0,5 GiB.</p>
      <p>Carico previsto sulla CPU: <strong>{estimate.load}</strong>, fino a {estimate.threads} thread. {estimate.level === "insufficient" ? "Possibili rallentamenti da memoria virtuale o mancato caricamento: scegli una versione più piccola." : estimate.load === "elevato" ? "Attese potenzialmente lunghe, soprattutto con immagini o ragionamento esteso." : "Adatto a una prova con domande brevi; verifica i tempi reali."}</p>
    </> : <p>Attendi la lettura della RAM e della dimensione esatta del file. Senza questi dati non viene formulata una previsione.</p>}
    <p className="model-fit-method">Stima prudenziale, non un benchmark: pesi + intervallo per cache e buffer, contesto fino a 2.048 token, una richiesta alla volta. Il carico è una classe indicativa basata su dimensioni, immagini e thread, non sulla potenza misurata della CPU. Architettura, banda della RAM, disco, temperatura e altre app possono cambiare molto i tempi. I token/s non sono prevedibili in modo affidabile da questi soli dati.</p>
    <p>La RAM libera si aggiorna durante l’uso. Se è già caricato un altro modello, liberalo prima del confronto. La stima non certifica compatibilità o qualità delle risposte.</p>
    </details>
    </div>
  </section>;
}
