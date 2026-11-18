// Local HTTP API for the school text and audio workspaces.

// Cached hardware specs
let cachedSpecs = null;
export const EXPECTED_SERVER_BUILD = "school-cpu-v2";

export const isLocalServerMode = () => {
  if (typeof window === "undefined") return false;
  return (
    window.location.protocol === "http:" ||
    window.location.protocol === "https:"
  );
};

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  return `${(value / 1024 ** idx).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function normalizeModel(model) {
  if (typeof model === "string") {
    return { filename: model, sizeBytes: 0, size: "Sconosciuto" };
  }
  return {
    ...model,
    filename: model?.filename || model?.name || "",
    name: model?.name || model?.filename || "",
    sizeBytes: Number(model?.sizeBytes || 0),
    size:
      model?.size ||
      (model?.sizeBytes ? formatBytes(model.sizeBytes) : "Sconosciuto"),
    format: model?.format || "File locale dei pesi",
    backendType: model?.backendType || "",
    resolution: model?.resolution || "",
    isProjector: Boolean(model?.isProjector),
    // Set by the local server: where a linked-in-place file lives, whether it went missing,
    // and what the file's header says it is ("image" | "text" | "speech")
    linkedFrom: model?.linkedFrom || "",
    missing: Boolean(model?.missing),
    detectedKind: model?.detectedKind || "",
  };
}

async function readJsonResponse(
  res,
  fallbackMessage = "Il server locale ha restituito una risposta non valida.",
) {
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text || "{}");
  } catch (_) {
    const looksLikeHtml =
      text.trim().startsWith("<!doctype") || text.trim().startsWith("<html");
    throw new Error(
      looksLikeHtml
        ? "Il server locale usa una versione precedente dell’app. Riavvia Local Studio."
        : fallbackMessage,
    );
  }

  if (!res.ok || data.ok === false) {
    if (data.error === "Unknown API endpoint") {
      throw new Error(
        "Riavvia Local Studio per caricare la versione aggiornata del server.",
      );
    }
    throw new Error(data.error || `Richiesta non riuscita (HTTP ${res.status})`);
  }
  return data;
}

export async function getHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        data.error || `Verifica del server non riuscita (HTTP ${res.status})`,
      );
    return {
      ...data,
      stale: data.build !== EXPECTED_SERVER_BUILD,
    };
  } catch (err) {
    return {
      ok: false,
      stale: true,
      build: "unknown",
      issues: [err.message || "Impossibile collegarsi al server locale. Verifica che il programma di avvio sia aperto."],
      checks: [],
      ports: {},
    };
  }
}

export async function getDiagnostics() {
  const res = await fetch("/api/diagnostics");
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

// Get CPU and GPU specifications
export async function getHardwareSpecs() {
  if (cachedSpecs) return cachedSpecs;
  const res = await fetch("/api/hardware-specs");
  cachedSpecs = await readJsonResponse(res);
  return cachedSpecs;
}

// Get CPU/RAM/VRAM real-time utilization
export async function getTelemetry() {
  return await readJsonResponse(await fetch("/api/telemetry"));
}

// Get list of model files on the USB

// Start (or restart) backend stable-diffusion.cpp server with correct CLI flags
// In web/portable mode this calls serve.cjs management API which restarts the
// sd-vulkan.exe process with --steps, --cfg-scale, --sampling-method flags.

// Stop backend server

// Get current backend status and active settings

export async function getLlmStatus() {
  try {
    const res = await fetch("/api/llm/status");
    return await readJsonResponse(
      res,
      "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
    );
  } catch (err) {
    return {
      ready: false,
      running: false,
      backendInstalled: false,
      error: err.message,
      settings: {},
    };
  }
}

export async function listLlmModels() {
  const res = await fetch("/api/llm/models");
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return (data.models || []).map(normalizeModel);
}

export async function listLlmConversations() {
  const res = await fetch("/api/llm/conversations");
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return data.conversations || [];
}

export async function saveLlmConversation(conversation) {
  const res = await fetch("/api/llm/save-conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation }),
  });
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return data.conversation;
}

export async function deleteLlmConversation(id) {
  const res = await fetch("/api/llm/delete-conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function startLlm(model, options = {}) {
  const res = await fetch("/api/llm/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      threads: options.threads,
      contextSize: options.contextSize,
      gpuLayers: options.gpuLayers,
      enableThinking: options.enableThinking,
      flashAttn: options.flashAttn,
      cacheTypeK: options.cacheTypeK,
      cacheTypeV: options.cacheTypeV,
      mlock: options.mlock,
      mmap: options.mmap,
      cachePrompt: options.cachePrompt,
      defragThold: options.defragThold,
      batchSize: options.batchSize,
      ubatchSize: options.ubatchSize,
      performanceProfile: options.performanceProfile,
      preferredBackend: options.preferredBackend,
    }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function stopLlm() {
  const res = await fetch("/api/llm/stop", { method: "POST" });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function chatWithLlm(messages, options = {}) {
  const res = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      // New sampling parameters
      top_p: options.topP,
      top_k: options.topK,
      min_p: options.minP,
      repeat_penalty: options.repeatPenalty,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      seed: options.seed,
      stop: options.stop,
      useWeb: options.useWeb === true,
      timeFilter: options.timeFilter || "any",
    }),
  });
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Il modello di testo ha restituito una risposta vuota.");
  return {
    content,
    usage: data?.usage || null,
  };
}

export async function streamChatWithLlm(
  messages,
  options = {},
  onToken = () => {},
) {
  const fetchOpts = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
      // New sampling parameters
      top_p: options.topP,
      top_k: options.topK,
      min_p: options.minP,
      repeat_penalty: options.repeatPenalty,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      seed: options.seed,
      stop: options.stop,
      useWeb: options.useWeb === true,
      timeFilter: options.timeFilter || "any",
    }),
  };
  if (options.signal) {
    fetchOpts.signal = options.signal;
  }
  const res = await fetch("/api/llm/chat", fetchOpts);

  if (!res.ok) {
    const data = await readJsonResponse(
      res,
      `Richiesta alla chat non riuscita (HTTP ${res.status}).`,
    );
    throw new Error(data.error || `Richiesta alla chat non riuscita (HTTP ${res.status}).`);
  }
  if (!res.body) throw new Error("Questo browser non supporta la ricezione progressiva delle risposte.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let content = "";
  let reasoningContent = "";
  let usage = null;
  let timings = null;
  let finishReason = null;
  let webSources = [];

  const normalizeTextDelta = (value) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item?.text === "string") return item.text;
          if (typeof item?.content === "string") return item.content;
          return "";
        })
        .join("");
    }
    if (value && typeof value === "object") {
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
    }
    return "";
  };

  const consumeEvent = (eventText) => {
    const data = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return data === "[DONE]";

    const eventName = eventText
      .split(/\r?\n/)
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      console.warn("Failed to parse EventStream JSON:", eventText, err);
      return false;
    }
    if (parsed.error) {
      throw new Error(
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error.message ||
              "Il modello di testo ha segnalato un errore durante la risposta.",
      );
    }
    if (eventName === "web_sources") {
      webSources = parsed.sources || [];
      return false;
    }
    const choice = parsed.choices?.[0];
    const token = normalizeTextDelta(
      choice?.delta?.content ??
        choice?.message?.content ??
        choice?.text ??
        parsed.content ??
        parsed.response,
    );
    const reasoningToken = normalizeTextDelta(
      choice?.delta?.reasoning_content ??
        choice?.delta?.reasoning ??
        choice?.delta?.thinking ??
        choice?.message?.reasoning_content ??
        parsed.reasoning_content,
    );
    if (choice?.finish_reason) finishReason = choice.finish_reason;

    if (token || reasoningToken) {
      content += token;
      reasoningContent += reasoningToken;
      onToken(token, content, reasoningToken, reasoningContent);
    }
    if (parsed.usage) usage = parsed.usage;
    if (parsed.timings) timings = parsed.timings;
    return false;
  };

  let finished = false;
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      for (const eventText of events) {
        if (consumeEvent(eventText)) {
          finished = true;
          break;
        }
      }
      if (done) break;
    }

    if (!finished && buffer.trim()) consumeEvent(buffer);
    if (!content && !reasoningContent)
      throw new Error("Il modello di testo non ha prodotto una risposta.");
    return {
      content,
      reasoningContent,
      usage,
      timings,
      finishReason,
      webSources,
    };
  } finally {
    reader.releaseLock();
  }
}

export async function downloadLlmModel(url, filename = null) {
  const res = await fetch("/api/llm/download-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      filename,
    }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function importLlmModel(file, onProgress, signal) {
  return await uploadModelFileToEndpoint(
    file,
    "/api/llm/import-model",
    onProgress,
    signal,
  );
}

export async function deleteLlmModel(filename) {
  const res = await fetch("/api/llm/delete-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function getSpeechStatus() {
  try {
    const res = await fetch("/api/speech/status");
    return await readJsonResponse(
      res,
      "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
    );
  } catch (err) {
    return {
      ready: false,
      running: false,
      backendInstalled: false,
      error: err.message,
      settings: {},
    };
  }
}

export async function listSpeechModels() {
  const res = await fetch("/api/speech/models");
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return data.models || [];
}

export async function startSpeech(model, options = {}) {
  const res = await fetch("/api/speech/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      language: options.language || "auto",
      threads: options.threads,
      backendPreference: options.backendPreference || "auto",
    }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function stopSpeech() {
  const res = await fetch("/api/speech/stop", { method: "POST" });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function transcribeSpeech(fileOrBlob, options = {}) {
  const params = new URLSearchParams();
  if (options.model) params.set("model", options.model);
  if (options.language) params.set("language", options.language);
  if (options.filename) params.set("filename", options.filename);
  if (options.threads) params.set("threads", String(options.threads));
  if (options.backendPreference)
    params.set("backendPreference", options.backendPreference);
  if (options.translate) params.set("translate", "true");
  if (options.save === false) params.set("save", "false");

  const res = await fetch(`/api/speech/transcribe?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: fileOrBlob,
    signal: options.signal,
  });
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return data.transcription;
}

export async function downloadSpeechModel(modelIdOrUrl, filename = null) {
  const isUrl = /^https?:\/\//i.test(String(modelIdOrUrl || ""));
  const res = await fetch("/api/speech/download-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: isUrl ? "" : modelIdOrUrl,
      url: isUrl ? modelIdOrUrl : "",
      filename,
    }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function importSpeechModel(file, onProgress, signal) {
  return await uploadModelFileToEndpoint(
    file,
    "/api/speech/import-model",
    onProgress,
    signal,
  );
}

export async function deleteSpeechModel(filename) {
  const res = await fetch("/api/speech/delete-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function listSpeechTranscriptions() {
  const res = await fetch("/api/speech/transcriptions");
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return data.transcriptions || [];
}

export async function deleteSpeechTranscription(filename) {
  const res = await fetch("/api/speech/delete-transcription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function getTtsStatus() {
  try {
    const res = await fetch("/api/tts/status");
    return await readJsonResponse(
      res,
      "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
    );
  } catch (err) {
    return {
      ready: false,
      running: false,
      runtimeInstalled: false,
      error: err.message,
      settings: {},
      voices: [],
    };
  }
}

export async function listTtsModels() {
  const res = await fetch("/api/tts/models");
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return data.models || [];
}

export async function startTts(model, options = {}) {
  const res = await fetch("/api/tts/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice: options.voice,
      speed: options.speed,
    }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function stopTts() {
  const res = await fetch("/api/tts/stop", { method: "POST" });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function speakTts(text, options = {}) {
  const res = await fetch("/api/tts/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model: options.model,
      voice: options.voice,
      speed: options.speed,
    }),
    signal: options.signal,
  });
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return data.output;
}

export async function downloadTtsModel(modelIdOrUrl, filename = null) {
  const res = await fetch("/api/tts/download-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelIdOrUrl,
      filename,
    }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function deleteTtsModel(filename) {
  const res = await fetch("/api/tts/delete-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

export async function listTtsOutputs() {
  const res = await fetch("/api/tts/outputs");
  const data = await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
  return data.outputs || [];
}

export async function deleteTtsOutput(filename) {
  const res = await fetch("/api/tts/delete-output", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  return await readJsonResponse(
    res,
    "Il server locale ha restituito dati non validi. Riavvia Local Studio e riprova.",
  );
}

// List model files from the models folder (via management API in web mode)

// Generate image (T2I / I2I)
// Handles API calls to sd-server. If the server is unreachable or returns an error,
// we surface that error to the UI instead of silently returning a fake placeholder.

// Perform model file import (copy to USB in Tauri, simulated in Web mode)

function uploadModelFileToEndpoint(file, endpoint, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();
    let abortedByUser = false;

    xhr.open("POST", `${endpoint}?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    const abortUpload = () => {
      abortedByUser = true;
      xhr.abort();
    };
    if (signal) {
      if (signal.aborted) {
        abortUpload();
      } else {
        signal.addEventListener("abort", abortUpload, { once: true });
      }
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;

      const elapsedSecs = Math.max(0.1, (Date.now() - startedAt) / 1000);
      const speedBytes = event.loaded / elapsedSecs;
      const remainingBytes = Math.max(0, event.total - event.loaded);
      onProgress({
        filename: file.name,
        progress: (event.loaded / event.total) * 100,
        speed_mb_s: speedBytes / (1024 * 1024),
        eta_secs: remainingBytes / Math.max(1, speedBytes),
        status: "Copia nella cartella dei modelli...",
      });
    };

    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch (_) {}

      if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
        if (onProgress) {
          onProgress({
            filename: file.name,
            progress: 100,
            speed_mb_s: 0,
            eta_secs: 0,
            status: "Importazione completata",
          });
        }
        resolve(data);
      } else {
        reject(new Error(data.error || `Importazione non riuscita (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () =>
      reject(new Error("Importazione non riuscita durante il trasferimento del file."));
    xhr.onabort = () =>
      reject(
        new DOMException(
          abortedByUser ? "Importazione annullata." : "Importazione interrotta.",
          "AbortError",
        ),
      );
    xhr.send(file);
  });
}

// Delete model file (Tauri disk deletion or localStorage cleanup)
// Refile a model under another type ("image" | "text" | "speech")

// Opens the system file dialog (from the local server) and resolves to the chosen path, or "" if cancelled

// Use a model file where it already is: the app keeps a link to it instead of a copy

// Ping the server to check if it is active and responding

// Wait for the server to be ready by polling

// Start model file download from a URL on the server

export async function cancelModelDownload() {
  try {
    const res = await fetch("/api/cancel-download", { method: "POST" });
    return await res.json();
  } catch (e) {
    console.error("Failed to cancel model download:", e);
    return { ok: false, error: e.message };
  }
}

// Get the server-side model download progress
export async function getDownloadProgress() {
  try {
    const res = await fetch("/api/download-progress");
    return await res.json();
  } catch (e) {
    console.error("Failed to get download progress:", e);
    return { active: false, error: e.message };
  }
}

// Get the server-side image generation progress
