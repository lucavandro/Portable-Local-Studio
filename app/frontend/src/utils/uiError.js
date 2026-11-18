// Browser errors are often in English even when the page language is Italian.
export function describeUiError(error) {
  const message = error?.message || String(error || "");
  const name = error?.name;
  if (name === "NotAllowedError" || /permission denied|permission dismissed/i.test(message))
    return "Accesso al microfono non consentito. Abilita il microfono nelle autorizzazioni del browser e riprova.";
  if (name === "NotFoundError" || /requested device not found/i.test(message))
    return "Nessun microfono disponibile. Collega un microfono e riprova.";
  if (name === "NotReadableError" || /could not start audio source/i.test(message))
    return "Impossibile usare il microfono. Verifica che non sia occupato da un altro programma.";
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(message))
    return "Impossibile collegarsi al server locale. Lascia aperta la finestra di avvio dell’app e riprova.";
  if (name === "NotSupportedError")
    return "Il browser non supporta questa operazione audio. Prova un file WAV o un browser aggiornato.";
  return message || "Operazione non riuscita. Riprova o chiedi aiuto al docente.";
}
