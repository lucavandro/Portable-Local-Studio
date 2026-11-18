import "../styles/school.css";
export default function Settings({
  textSettings,
  setTextSettings,
  speechSettings,
  setSpeechSettings,
  health,
  refreshReadiness,
  copyDiagnostics,
  diagnosticsCopied,
  isReadinessBusy,
  fontSize,
  setFontSize,
}) {
  const update = (key, value) =>
    setTextSettings((previous) => ({ ...previous, [key]: value }));
  return (
    <section className="school-page">
      <h1>Impostazioni del laboratorio</h1>
      <p>
        Chat, documenti, trascrizione e voce sono elaborati localmente. Nessun
        servizio AI a pagamento.
      </p>
      <div className="school-card">
        <h2>Esperimenti con la chat</h2>
        <label>
          Temperatura: {textSettings.temperature}
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.1"
            value={textSettings.temperature}
            onChange={(e) => update("temperature", Number(e.target.value))}
          />
        </label>
        <p>
          Confronta risposte più regolari e risposte più varie usando la stessa
          domanda.
        </p>
        <label>
          Lunghezza massima della risposta
          <select
            value={textSettings.maxTokens}
            onChange={(e) =>
              setTextSettings((previous) => ({
                ...previous,
                maxTokens: Number(e.target.value),
                responseTokenMode: "manual",
              }))
            }
          >
            {[128, 256, 384, 512].map((n) => (
              <option key={n} value={n}>
                {n} token
              </option>
            ))}
          </select>
        </label>
        <label>
          Istruzioni iniziali del modello
          <textarea
            rows="4"
            value={textSettings.systemPrompt}
            onChange={(e) => update("systemPrompt", e.target.value)}
          />
        </label>
        <p>
          Profilo CPU: contesto fino a 2.048 token, massimo 4 thread,
          un’attività di calcolo alla volta. Per i documenti lunghi seleziona un
          estratto.
        </p>
      </div>
      <div className="school-card">
        <h2>Accessibilità e audio</h2>
        <label>
          Dimensione testo
          <select
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          >
            {[14, 16, 18, 20, 22].map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </label>
        <label>
          Lingua predefinita della trascrizione
          <select
            value={speechSettings.language}
            onChange={(e) =>
              setSpeechSettings((previous) => ({
                ...previous,
                language: e.target.value,
                backendPreference: "cpu",
              }))
            }
          >
            <option value="auto">Rilevamento automatico</option>
            <option value="it">Italiano</option>
            <option value="en">Inglese</option>
          </select>
        </label>
        <p>
          Kokoro Q8 usa voci inglesi. Apri Trascrivi o Voce per usare l’audio;
          il modello chat viene scaricato dalla memoria quando serve.
        </p>
      </div>
      <div className="school-card">
        <h2>Controlli per il docente</h2>
        <p role="status">
          {health?.stale
            ? "Riavvia Local Studio per caricare la versione aggiornata."
            : health?.ok
              ? "Motore chat e cartelle disponibili."
              : "Installazione da completare."}
        </p>
        {health?.issues?.map((issue) => (
          <p key={issue}>{issue}</p>
        ))}
        <p>
          Trascrizione:{" "}
          {health?.speech?.installed
            ? "motore installato"
            : "eseguire il setup"}
          . Voce:{" "}
          {health?.tts?.runtimeInstalled
            ? "runtime installato"
            : "eseguire il setup"}
          .
        </p>
        <div className="school-tabs">
          <button
            className="m3-btn m3-btn-outlined"
            disabled={isReadinessBusy}
            onClick={refreshReadiness}
          >
            Ricontrolla
          </button>
          <button className="m3-btn m3-btn-outlined" onClick={copyDiagnostics}>
            {diagnosticsCopied ? "Copiato" : "Copia diagnostica"}
          </button>
        </div>
      </div>
    </section>
  );
}
