const http = require("http");
const https = require("https");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync, execSync, exec, execFile } = require("child_process");
const { detectModelKindCached } = require("./model-kind.cjs");

// HTTP keep-alive agent for llama-server (eliminates TCP handshake per request)
const llmHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 1,
  keepAliveMsecs: 30000,
});

function readPort(value, fallback) {
  const port = parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

const PORT_FRONTEND = readPort(
  process.env.PORT || process.env.FRONTEND_PORT,
  1420,
);

const PREFERRED_LLM_PORT = readPort(process.env.LLM_PORT, 10086);
const PREFERRED_SPEECH_PORT = readPort(process.env.SPEECH_PORT, 10088);
const PREFERRED_TTS_PORT = readPort(process.env.TTS_PORT, 10089);

let PORT_LLM = PREFERRED_LLM_PORT;
let PORT_SPEECH = PREFERRED_SPEECH_PORT;
let PORT_TTS = PREFERRED_TTS_PORT;
const MAX_JSON_BODY_BYTES = 64 * 1024 * 1024;
const SERVER_BUILD = "school-cpu-v2";
const ROOT = path.join(__dirname, "..", "..");
const DIST = path.join(ROOT, "app", "dist");

const osPlatform = process.platform;
const LLM_MODELS = path.join(ROOT, "app", "llm-models");
if (!fs.existsSync(LLM_MODELS)) {
  fs.mkdirSync(LLM_MODELS, { recursive: true });
}
const CHAT_HISTORY = path.join(ROOT, "app", "chat-history");
if (!fs.existsSync(CHAT_HISTORY)) {
  fs.mkdirSync(CHAT_HISTORY, { recursive: true });
}
const LLM_BACKEND_PATHS = {
  winCpu: path.join(
    ROOT,
    "app",
    "llm-backend",
    "win",
    "cpu",
    "llama-server.exe",
  ),

  linuxCpu: path.join(
    ROOT,
    "app",
    "llm-backend",
    "linux",
    "cpu",
    "llama-server",
  ),
  macArm64: path.join(
    ROOT,
    "app",
    "llm-backend",
    "mac",
    "arm64",
    "llama-server",
  ),
  macX64: path.join(ROOT, "app", "llm-backend", "mac", "x64", "llama-server"),
};
const LLM_CONFIG_DIR = path.join(ROOT, "app", "config");
const LLM_MODEL_SETTINGS_PATH = path.join(
  LLM_CONFIG_DIR,
  "llm-model-settings.json",
);

if (!fs.existsSync(LLM_CONFIG_DIR)) {
  fs.mkdirSync(LLM_CONFIG_DIR, { recursive: true });
}
const SPEECH_MODELS = path.join(ROOT, "app", "speech-models");
if (!fs.existsSync(SPEECH_MODELS)) {
  fs.mkdirSync(SPEECH_MODELS, { recursive: true });
}
const TRANSCRIPTIONS = path.join(ROOT, "app", "transcriptions");
if (!fs.existsSync(TRANSCRIPTIONS)) {
  fs.mkdirSync(TRANSCRIPTIONS, { recursive: true });
}
const TTS_MODELS = path.join(ROOT, "app", "tts-models");
if (!fs.existsSync(TTS_MODELS)) {
  fs.mkdirSync(TTS_MODELS, { recursive: true });
}
const TTS_OUTPUTS = path.join(ROOT, "app", "tts-outputs");
if (!fs.existsSync(TTS_OUTPUTS)) {
  fs.mkdirSync(TTS_OUTPUTS, { recursive: true });
}
const TTS_CACHE = path.join(ROOT, "app", "tts-cache");
if (!fs.existsSync(TTS_CACHE)) {
  fs.mkdirSync(TTS_CACHE, { recursive: true });
}
const TTS_RUNTIME = path.join(ROOT, "app", "tts-runtime");
const TTS_WORKER = path.join(
  ROOT,
  "scripts",
  "workers",
  "tts-kokoro-worker.mjs",
);
const SPEECH_BACKEND_ROOT = path.join(ROOT, "app", "speech-backend");

const SPEECH_MODEL_CATALOG = [
  {
    id: "tiny",
    name: "Whisper Tiny · multilingue",
    filename: "ggml-tiny.bin",
    size: "75 MB",
    language: "Multilingual",
    recommended: true,
  },
  {
    id: "base",
    name: "Whisper Base · multilingue",
    filename: "ggml-base.bin",
    size: "142 MB",
    language: "Multilingual",
    recommended: false,
  },
  {
    id: "base-q5_1",
    name: "Whisper Base Q5 · multilingue",
    filename: "ggml-base-q5_1.bin",
    size: "57 MB",
    language: "Multilingual",
    recommended: false,
  },
];
const TTS_MODEL_CATALOG = [
  {
    id: "kokoro-onnx-q8",
    name: "Kokoro 82M ONNX Q8",
    filename: "kokoro-onnx-q8.json",
    modelId: "onnx-community/Kokoro-82M-v1.0-ONNX",
    dtype: "q8",
    size: "Cache locale",
    format: "Kokoro ONNX",
    recommended: true,
  },
];
const TTS_VOICES = require("../../app/frontend/src/config/tts-voices.json");
const DEFAULT_TTS_VOICE = TTS_VOICES[0].id;
function normalizeTtsVoice(voice) {
  return TTS_VOICES.some((entry) => entry.id === voice)
    ? voice
    : DEFAULT_TTS_VOICE;
}
let llmProc = null;
let llmProcSeq = 0;
let llmReady = false;
let llmError = null;
let llmOperationQueue = Promise.resolve();
let speechReady = false;
let speechError = null;

let speechSettings = {
  model: null,
  language: "auto",
  threads: Math.max(1, Math.min(8, os.cpus().length || 4)),
  backendPreference: "auto",
  backendBinary: "",
  backendMode: "",
};
let speechTranscriptionState = {
  active: false,
  phase: "",
  progress: 0,
  model: "",
  filename: "",
};
let ttsReady = false;
let ttsError = null;

let ttsSettings = {
  model: null,
  voice: DEFAULT_TTS_VOICE,
  speed: 1,
  dtype: "q8",
  backendMode: "Kokoro ONNX",
};
let ttsGenerationState = {
  active: false,
  phase: "",
  progress: 0,
  model: "",
  voice: "",
  output: "",
};

function modelName(value) {
  return path.basename(String(value || ""));
}

function jsonErrorStatus(err) {
  return (
    Number(err?.statusCode) ||
    (err?.code === "MODEL_ALREADY_ACTIVE" ? 409 : 500)
  );
}
let llmSettings = {
  model: null,
  threads: Math.max(1, Math.min(16, os.cpus().length || 4)),
  contextSize: 2048,
  gpuLayers: 0,
  backendMode: "",
  backendBinary: "",
  supportsVision: false,
  visionMode: "none",
  visionStatus: "Proiettore non caricato",
  flashAttn: true,
  cacheTypeK: "q8_0",
  cacheTypeV: "q8_0",
  mlock: false,
  mmap: true,
  cachePrompt: true,
  defragThold: 0.1,
  batchSize: 512,
  ubatchSize: 512,
  performanceProfile: "balanced",
};

function runExclusiveLlmOperation(operation) {
  const run = llmOperationQueue.catch(() => {}).then(operation);
  llmOperationQueue = run.catch(() => {});
  return run;
}
let lastCpuSample = null;

function roundGb(bytes) {
  return Math.round((bytes / 1024 ** 3) * 100) / 100;
}

// Detect physical CPU cores (not logical/hyperthreaded cores)
// llama.cpp docs: "Do NOT set threads too high — major cause of oversaturation"
function getPhysicalCores() {
  const cpus = os.cpus();
  const logicalCores = cpus.length;

  if (logicalCores <= 1) return 1;

  // Check if hyperthreading is likely: compare unique core IDs vs total
  // On Windows/Linux, os.cpus() lists each logical core separately
  // Physical cores typically have the same model but different speeds can indicate HT
  const uniqueModels = new Set(cpus.map((c) => c.model)).size;

  // If we have very few unique models relative to core count, likely HT
  // Also check: if logical cores is exactly 2x a common physical core count
  const commonPhysicalCounts = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32];
  const isLikelyHT = commonPhysicalCounts.some(
    (physical) => logicalCores === physical * 2,
  );

  if (isLikelyHT || uniqueModels < logicalCores / 2) {
    return Math.max(1, Math.floor(logicalCores / 2));
  }

  return logicalCores;
}

// Get optimal thread count for llama.cpp
// CPU mode: use physical cores directly

function getCpuSample() {
  return os.cpus().reduce(
    (acc, cpu) => {
      const times = cpu.times;
      acc.idle += times.idle;
      acc.total += times.user + times.nice + times.sys + times.idle + times.irq;
      return acc;
    },
    { idle: 0, total: 0 },
  );
}

function getCpuUsagePercent() {
  const current = getCpuSample();
  if (!lastCpuSample) {
    lastCpuSample = current;
    return 0;
  }

  const idleDelta = current.idle - lastCpuSample.idle;
  const totalDelta = current.total - lastCpuSample.total;
  lastCpuSample = current;

  if (totalDelta <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10),
  );
}

// ── NPU Detection ─────────────────────────────────────────────────────────────

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function getPersistedLlmModelSettings() {
  return readJsonFile(LLM_MODEL_SETTINGS_PATH, { models: {} });
}

function savePersistedLlmModelSettings(settings) {
  writeJsonFile(
    LLM_MODEL_SETTINGS_PATH,
    settings && typeof settings === "object" ? settings : { models: {} },
  );
}

function getLlmModelSettings(filename) {
  const safeFilename = path.basename(String(filename || ""));
  if (!safeFilename) return {};
  const settings = getPersistedLlmModelSettings();
  return settings.models?.[safeFilename] || {};
}

function updateLlmModelSettings(filename, patch) {
  const safeFilename = path.basename(String(filename || ""));
  if (!safeFilename) return {};
  const allSettings = getPersistedLlmModelSettings();
  if (!allSettings.models || typeof allSettings.models !== "object")
    allSettings.models = {};
  const previous = allSettings.models[safeFilename] || {};
  const next = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  allSettings.models[safeFilename] = next;
  savePersistedLlmModelSettings(allSettings);
  return next;
}

function getHardwareSpecs() {
  const cores = getPhysicalCores();
  return {
    os_name: os.type() + " " + os.release(),
    cpu_name: os.cpus()[0]?.model || "CPU",
    cpu_cores_physical: cores,
    cpu_cores_logical: os.cpus().length,
    ram_total_gb: roundGb(os.totalmem()),
    gpu_name: "CPU · laboratorio scolastico",
    tier: "low",
    recommended_text_settings: {
      contextSize: 2048,
      threads: Math.max(1, Math.min(4, cores - 1)),
      gpuLayers: 0,
      preferredBackend: "cpu",
    },
    recommended_models: [
      {
        name: "Qwen 2.5 0.5B Instruct · leggero",
        filename: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        approxSize: "491 MB",
        url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
        notes: "Per le prime prove su CPU. Supporta l'italiano.",
      },
      {
        name: "Qwen 2.5 1.5B Instruct · confronto",
        filename: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        approxSize: "1.12 GB",
        url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        notes: "Più capace, con tempi di risposta da verificare sul PC.",
      },
    ],
  };
}

function getTelemetry() {
  return {
    cpu_usage: getCpuUsagePercent(),
    ram_used_gb: roundGb(os.totalmem() - os.freemem()),
    ram_total_gb: roundGb(os.totalmem()),
  };
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  return `${(value / 1024 ** idx).toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

const RETRYABLE_FILE_CODES = new Set([
  "EACCES",
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "EPERM",
]);

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withFileRetrySync(operation, attempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return operation();
    } catch (err) {
      lastError = err;
      if (!RETRYABLE_FILE_CODES.has(err?.code) || attempt === attempts - 1)
        throw err;
      sleepSync(Math.min(1000, 100 * 2 ** attempt));
    }
  }
  throw lastError;
}

function describeStorageError(err, targetPath) {
  const target = path.basename(targetPath || "the destination file");
  if (err?.code === "ENOSPC" || err?.code === "EFBIG") {
    const detail = err?.message ? ` ${err.message}` : "";
    return `Impossibile scrivere ${target}: spazio disponibile insufficiente o file troppo grande per il formato del disco.${detail} Per i file grandi usa NTFS, exFAT, APFS o ext4; FAT32 ha un limite di 4 GB per file.`;
  }
  if (RETRYABLE_FILE_CODES.has(err?.code)) {
    return `Impossibile accedere a ${target} dopo diversi tentativi. Chiudi i programmi che usano il file e chiedi al docente di verificare antivirus e protezioni, poi riprova.`;
  }
  return err?.message || String(err);
}

function ensureStorageCapacity(targetDir, requiredBytes) {
  const bytes = Number(requiredBytes) || 0;
  if (bytes <= 0 || typeof fs.statfsSync !== "function") return;
  try {
    const stats = fs.statfsSync(targetDir);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    if (
      Number.isFinite(availableBytes) &&
      availableBytes > 0 &&
      bytes > availableBytes
    ) {
      const err = new Error(
        `Spazio disponibile: ${formatBytes(availableBytes)}. Spazio necessario: ${formatBytes(bytes)}.`,
      );
      err.code = "ENOSPC";
      throw err;
    }
  } catch (err) {
    if (err?.code === "ENOSPC") throw err;
  }
}

function replaceFileWithRetry(tempPath, destPath) {
  withFileRetrySync(() => {
    try {
      fs.unlinkSync(destPath);
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
    fs.renameSync(tempPath, destPath);
  });
}

function getPathInfo(label, targetPath, type = "file") {
  const exists = fs.existsSync(targetPath);
  return {
    label,
    path: targetPath,
    type,
    exists,
    ok: exists,
  };
}

function isDirWritable(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const testFile = path.join(
      dirPath,
      `.uncensored-ai-studio-write-test-${Date.now()}.tmp`,
    );
    fs.writeFileSync(testFile, "ok", "utf8");
    fs.unlinkSync(testFile);
    return true;
  } catch (_) {
    return false;
  }
}

function getDirInfo(label, targetPath) {
  const exists = fs.existsSync(targetPath);
  const writable = exists ? isDirWritable(targetPath) : false;
  return {
    label,
    path: targetPath,
    type: "directory",
    exists,
    writable,
    ok: exists && writable,
  };
}

function getPathSize(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) return 0;
    const stat = fs.statSync(targetPath);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return fs
      .readdirSync(targetPath)
      .reduce((sum, name) => sum + getPathSize(path.join(targetPath, name)), 0);
  } catch (_) {
    return 0;
  }
}

function pathInside(childPath, parentPath) {
  const relative = path.relative(
    path.resolve(parentPath),
    path.resolve(childPath),
  );
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function checkPort(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve({ port, available: false, inUse: true }))
      .once("listening", () => {
        tester.close(() => resolve({ port, available: true, inUse: false }));
      })
      .listen(port, "127.0.0.1");
  });
}

async function waitForPortAvailable(port, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await checkPort(port);
    if (status.available) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function findAvailableLlmPort() {
  const preferred = await checkPort(PREFERRED_LLM_PORT);
  if (preferred.available) return PREFERRED_LLM_PORT;

  for (let port = 28121; port <= 28160; port += 1) {
    const candidate = await checkPort(port);
    if (candidate.available) {
      console.log(
        `  [llm] Preferred port ${PREFERRED_LLM_PORT} is busy; using ${port} instead.`,
      );
      return port;
    }
  }

  throw new Error(
    `Nessuna porta libera per la chat. Provate ${PREFERRED_LLM_PORT} e 28121-28160.`,
  );
}

async function findAvailableSpeechPort() {
  const preferred = await checkPort(PREFERRED_SPEECH_PORT);
  if (preferred.available) return PREFERRED_SPEECH_PORT;

  for (let port = 28161; port <= 28190; port += 1) {
    const candidate = await checkPort(port);
    if (candidate.available) {
      console.log(
        `  [speech] Preferred port ${PREFERRED_SPEECH_PORT} is busy; using ${port} instead.`,
      );
      return port;
    }
  }

  throw new Error(
    `Nessuna porta libera per la trascrizione. Provate ${PREFERRED_SPEECH_PORT} e 28161-28190.`,
  );
}

function getLlmBackend() {
  return getLlmBackendCandidates()[0] || null;
}

function resolveSystemLlamaServer() {
  const configured =
    process.env.LOCALAI_LLM_SYSTEM_SERVER ||
    process.env.LLAMA_SERVER_PATH ||
    "";
  if (configured && fs.existsSync(configured)) return configured;
  return "";
}

function getAllLlmBackendCandidates() {
  const installed =
    osPlatform === "win32"
      ? LLM_BACKEND_PATHS.winCpu
      : osPlatform === "darwin"
        ? process.arch === "arm64"
          ? LLM_BACKEND_PATHS.macArm64
          : LLM_BACKEND_PATHS.macX64
        : LLM_BACKEND_PATHS.linuxCpu;
  return [
    {
      key: "cpu",
      path: resolveSystemLlamaServer() || installed,
      mode: "CPU",
      portable: !resolveSystemLlamaServer(),
    },
  ];
}

function getLlmBackendProbe() {
  const candidates = getAllLlmBackendCandidates().map((b) => ({
    ...b,
    installed: fs.existsSync(b.path),
    detected: fs.existsSync(b.path),
    devices: [],
  }));
  const available = candidates.filter((b) => b.installed);
  return { candidates, available, selected: available[0] || null };
}

function getLlmBackendCandidates() {
  return getLlmBackendProbe().available;
}

// macOS writes "._name" AppleDouble files next to real files on exFAT and FAT drives.
// They are never models or user data, so listings of the app's data folders skip them.
function readdirVisible(dir) {
  return fs.readdirSync(dir).filter((name) => !name.startsWith("._"));
}

// Models can be linked in place from elsewhere on disk instead of copied in (POST /api/link-model).
// A link reports where its file lives, and whether that file has since been moved or deleted.
function describeLinkedModel(fullPath) {
  try {
    if (!fs.lstatSync(fullPath).isSymbolicLink()) return {};
    const target = path.resolve(
      path.dirname(fullPath),
      fs.readlinkSync(fullPath),
    );
    return { linkedFrom: target, missing: !fs.existsSync(target) };
  } catch (_) {
    return {};
  }
}

// The app's folder for each model type, and which loaded model would block moving a file out of it

function detectedKindFor(fullPath, link = {}) {
  return link.missing ? "unknown" : detectModelKindCached(fullPath).kind;
}

function getLlmModels() {
  try {
    return readdirVisible(LLM_MODELS)
      .filter((filename) => filename.toLowerCase().endsWith(".gguf"))
      .map((filename) => {
        const fullPath = path.join(LLM_MODELS, filename);
        const link = describeLinkedModel(fullPath);
        const sizeBytes = link.missing ? 0 : fs.statSync(fullPath).size;
        const lower = filename.toLowerCase();
        return {
          filename,
          name: filename,
          sizeBytes,
          size: link.missing ? "" : formatBytes(sizeBytes),
          format: "GGUF",
          isProjector: lower.includes("mmproj"),
          detectedKind: detectedKindFor(fullPath, link),
          ...link,
        };
      })
      .filter(
        (model) =>
          !model.missing &&
          !model.isProjector &&
          model.sizeBytes <= 2 * 1024 ** 3 &&
          model.detectedKind === "text" &&
          !/vision|llava|qwen.*vl|smolvlm|moondream/i.test(model.filename),
      );
  } catch (_) {
    return [];
  }
}

function getSpeechBackendCandidates() {
  const folder =
    osPlatform === "win32" ? "win" : osPlatform === "darwin" ? "mac" : "linux";
  const suffix = osPlatform === "win32" ? ".exe" : "";
  const cli = path.join(
    SPEECH_BACKEND_ROOT,
    folder,
    "cpu",
    "whisper-cli" + suffix,
  );
  return [
    {
      key: "cpu",
      label: "CPU",
      mode: "CPU",
      cli,
      server: "",
      installed: fs.existsSync(cli),
      available: fs.existsSync(cli),
      pathHint: path.dirname(cli),
    },
  ];
}

function normalizeSpeechBackendPreference() {
  return "cpu";
}

function getSpeechBackend() {
  const backend = getSpeechBackendCandidates()[0];
  return {
    ...backend,
    cli: backend.installed ? backend.cli : null,
    preference: "cpu",
    candidates: [backend],
  };
}

function getSpeechModels() {
  const catalog = SPEECH_MODEL_CATALOG.map((model) => {
    const modelPath = path.join(SPEECH_MODELS, model.filename);
    const installed = fs.existsSync(modelPath);
    return {
      ...model,
      installed,
      sizeBytes: installed ? getPathSize(modelPath) : 0,
      localSize: installed ? formatBytes(getPathSize(modelPath)) : "",
      url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.filename}`,
    };
  });

  const known = new Set(catalog.map((model) => model.filename.toLowerCase()));
  let custom = [];
  try {
    custom = readdirVisible(SPEECH_MODELS)
      .filter(
        (filename) =>
          filename.toLowerCase().endsWith(".bin") &&
          !known.has(filename.toLowerCase()),
      )
      .map((filename) => {
        const fullPath = path.join(SPEECH_MODELS, filename);
        const link = describeLinkedModel(fullPath);
        const sizeBytes = link.missing ? 0 : getPathSize(fullPath);
        return {
          ...link,
          detectedKind: detectedKindFor(fullPath, link),
          id: filename,
          name: filename,
          filename,
          size: formatBytes(sizeBytes),
          localSize: formatBytes(sizeBytes),
          sizeBytes,
          language: "Custom",
          installed: true,
          recommended: false,
          custom: true,
        };
      });
  } catch (_) {}
  return [...catalog, ...custom];
}

function resolveSpeechModel(value) {
  const raw = String(value || "").trim();
  const model =
    getSpeechModels().find(
      (item) => item.id === raw || item.filename === raw,
    ) || getSpeechModels().find((item) => item.installed);
  if (!model) throw new Error("Scarica o importa prima un modello Whisper.");
  const modelPath = path.join(SPEECH_MODELS, path.basename(model.filename));
  if (!pathInside(modelPath, SPEECH_MODELS) || !fs.existsSync(modelPath)) {
    throw new Error(`Modello di trascrizione non installato: ${model.filename}`);
  }
  if (fs.statSync(modelPath).size > 200 * 1024 ** 2)
    throw new Error("Usa Whisper Tiny o Base: il limite scolastico è 200 MB.");
  return { ...model, path: modelPath };
}

function getTtsManifestPath(filename) {
  const manifestPath = path.join(
    TTS_MODELS,
    path.basename(String(filename || "")),
  );
  return pathInside(manifestPath, TTS_MODELS) ? manifestPath : "";
}

function readTtsManifest(filename) {
  const manifestPath = getTtsManifestPath(filename);
  if (!manifestPath || !fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (_) {
    return null;
  }
}

function installTtsCatalogModel(modelIdOrFilename) {
  const raw = String(modelIdOrFilename || "").trim();
  const catalogModel =
    TTS_MODEL_CATALOG.find(
      (model) => model.id === raw || model.filename === raw,
    ) || TTS_MODEL_CATALOG[0];
  if (!catalogModel) throw new Error("Modello vocale sconosciuto.");
  const manifestPath = getTtsManifestPath(catalogModel.filename);
  const manifest = {
    ...catalogModel,
    installed: true,
    createdAt: new Date().toISOString(),
    notes:
      "Al primo utilizzo i pesi di Kokoro vengono scaricati e conservati nella cartella app/tts-cache.",
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

function getTtsModels() {
  const catalog = TTS_MODEL_CATALOG.map((model) => {
    const manifest = readTtsManifest(model.filename);
    const installed = Boolean(manifest);
    const manifestPath = getTtsManifestPath(model.filename);
    const sizeBytes = installed ? getPathSize(manifestPath) : 0;
    return {
      ...model,
      ...(manifest || {}),
      notes: model.notes,
      installed,
      sizeBytes,
      localSize: installed ? formatBytes(sizeBytes) : "",
      url: `kokoro://install/${model.id}`,
    };
  });

  const known = new Set(catalog.map((model) => model.filename.toLowerCase()));
  let custom = [];
  try {
    custom = readdirVisible(TTS_MODELS)
      .filter(
        (filename) =>
          filename.toLowerCase().endsWith(".json") &&
          !known.has(filename.toLowerCase()),
      )
      .map((filename) => {
        const manifest = readTtsManifest(filename) || {};
        const sizeBytes = getPathSize(path.join(TTS_MODELS, filename));
        return {
          id: manifest.id || filename,
          name: manifest.name || filename,
          filename,
          modelId: manifest.modelId || "onnx-community/Kokoro-82M-v1.0-ONNX",
          dtype: manifest.dtype || "q8",
          format: manifest.format || "Kokoro ONNX",
          size: formatBytes(sizeBytes),
          localSize: formatBytes(sizeBytes),
          sizeBytes,
          installed: true,
          recommended: false,
          custom: true,
        };
      });
  } catch (_) {}
  return [...catalog, ...custom];
}

function resolveTtsModel(value) {
  const raw = String(value || "").trim();
  const model =
    getTtsModels().find((item) => item.id === raw || item.filename === raw) ||
    getTtsModels().find((item) => item.installed);
  if (!model)
    throw new Error(
      "Prepara prima un modello Kokoro dalla pagina Modelli, nella sezione Voce.",
    );
  const manifestPath = getTtsManifestPath(model.filename);
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`Modello vocale non installato: ${model.filename}`);
  }
  return { ...model, path: manifestPath };
}

function getTtsRuntimeStatus() {
  const nodeModules = path.join(TTS_RUNTIME, "node_modules");
  const installed = fs.existsSync(path.join(nodeModules, "kokoro-js"));
  return {
    installed:
      installed &&
      fs.existsSync(
        path.join(nodeModules, "@echogarden", "espeak-ng-emscripten"),
      ) &&
      fs.existsSync(TTS_WORKER),
    worker: TTS_WORKER,
    runtime: TTS_RUNTIME,
    cache: TTS_CACHE,
    backendMode: "Kokoro ONNX",
  };
}

function runExclusiveTtsOperation(operation) {
  const run = llmOperationQueue.catch(() => {}).then(operation);
  llmOperationQueue = run.catch(() => {});
  return run;
}

async function startTts(settings = {}) {
  const runtime = getTtsRuntimeStatus();
  if (!runtime.installed) {
    throw new Error(
      "Il motore vocale Kokoro non è installato. Riavvia il programma di avvio per completare la preparazione.",
    );
  }
  const model = resolveTtsModel(settings.model || ttsSettings.model);
  await killLlm();
  await stopSpeech();
  PORT_TTS = PREFERRED_TTS_PORT;
  ttsError = null;
  ttsReady = true;
  ttsSettings = {
    ...ttsSettings,
    model: model.filename,
    voice: normalizeTtsVoice(settings.voice || ttsSettings.voice),
    speed: Math.max(
      0.5,
      Math.min(2, Number(settings.speed) || ttsSettings.speed || 1),
    ),
    dtype: model.dtype || settings.dtype || ttsSettings.dtype || "q8",
    backendMode: runtime.backendMode,
  };
}

async function stopTts() {
  ttsReady = false;
  ttsError = null;
  ttsGenerationState = {
    active: false,
    phase: "",
    progress: 0,
    model: "",
    voice: "",
    output: "",
  };
}

function convertFloatWavToPcm16(buffer) {
  if (!isWaveBuffer(buffer)) return buffer;

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) break;

    if (id === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = { start, size };
    }

    offset = end + (size % 2);
  }

  if (
    !fmt ||
    !data ||
    fmt.audioFormat !== 3 ||
    fmt.bitsPerSample !== 32 ||
    fmt.channels < 1
  ) {
    return buffer;
  }

  const samples = Math.floor(data.size / 4);
  const pcmDataSize = samples * 2;
  const output = Buffer.alloc(44 + pcmDataSize);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + pcmDataSize, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(fmt.channels, 22);
  output.writeUInt32LE(fmt.sampleRate, 24);
  output.writeUInt32LE(fmt.sampleRate * fmt.channels * 2, 28);
  output.writeUInt16LE(fmt.channels * 2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(pcmDataSize, 40);

  for (let i = 0; i < samples; i += 1) {
    const floatValue = buffer.readFloatLE(data.start + i * 4);
    const clamped = Math.max(
      -1,
      Math.min(1, Number.isFinite(floatValue) ? floatValue : 0),
    );
    const intValue =
      clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    output.writeInt16LE(intValue, 44 + i * 2);
  }

  return output;
}

function ensureBrowserCompatibleTtsWav(filePath) {
  try {
    const original = fs.readFileSync(filePath);
    const converted = convertFloatWavToPcm16(original);
    if (converted !== original) {
      fs.writeFileSync(filePath, converted);
    }
  } catch (_) {}
}

function saveTtsOutput(result) {
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const base = `tts-${stamp}-${safeOutputName(result.voice || "voice")}`;
  const wavFilename = `${base}.wav`;
  const jsonFilename = `${base}.json`;
  const wavPath = path.join(TTS_OUTPUTS, wavFilename);
  const wavBuffer = convertFloatWavToPcm16(fs.readFileSync(result.wavPath));
  fs.writeFileSync(wavPath, wavBuffer);
  const metadata = {
    text: result.text || "",
    model: result.model,
    modelName: result.modelName,
    voice: result.voice,
    voiceName: result.voiceName,
    speed: result.speed,
    durationMs: result.durationMs,
    sampleRate: result.sampleRate || 24000,
    createdAt,
    audioFile: wavFilename,
    metadata: jsonFilename,
    displayName:
      result.displayName ||
      `${result.voiceName || result.voice} - ${createdAt}`,
    // Where each sentence starts and ends in the audio, for word highlighting during playback
    ...(Array.isArray(result.segments) && result.segments.length
      ? { segments: result.segments }
      : {}),
  };
  fs.writeFileSync(
    path.join(TTS_OUTPUTS, jsonFilename),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
  return {
    ...metadata,
    filename: jsonFilename,
    url: `/tts-outputs/${encodeURIComponent(wavFilename)}`,
  };
}

function listTtsOutputs() {
  try {
    return readdirVisible(TTS_OUTPUTS)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .map((file) => {
        const filePath = path.join(TTS_OUTPUTS, file);
        try {
          const metadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
          const stat = fs.statSync(filePath);
          if (metadata.audioFile) {
            const audioPath = path.join(
              TTS_OUTPUTS,
              path.basename(String(metadata.audioFile)),
            );
            if (
              pathInside(audioPath, TTS_OUTPUTS) &&
              fs.existsSync(audioPath)
            ) {
              ensureBrowserCompatibleTtsWav(audioPath);
            }
          }
          return {
            ...metadata,
            filename: file,
            displayName:
              metadata.displayName ||
              metadata.text?.slice(0, 48) ||
              metadata.audioFile ||
              file,
            sizeBytes: stat.size,
            size: formatBytes(stat.size),
            modifiedAt: stat.mtime.toISOString(),
            createdAt: metadata.createdAt || stat.mtime.toISOString(),
            url: metadata.audioFile
              ? `/tts-outputs/${encodeURIComponent(metadata.audioFile)}`
              : "",
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      );
  } catch (_) {
    return [];
  }
}

async function synthesizeTts(text, options = {}) {
  await killLlm();
  return new Promise((resolve, reject) => {
    const cleanedText = String(text || "").trim();
    if (!cleanedText) {
      reject(new Error("Scrivi un testo da leggere."));
      return;
    }
    if (cleanedText.length > 5000) {
      reject(
        new Error("Il testo da leggere è troppo lungo. Il limite è di 5.000 caratteri."),
      );
      return;
    }
    const runtime = getTtsRuntimeStatus();
    if (!runtime.installed) {
      reject(new Error("Il motore vocale Kokoro non è installato."));
      return;
    }
    const model = resolveTtsModel(options.model || ttsSettings.model);
    const voice = normalizeTtsVoice(options.voice || ttsSettings.voice);
    const voiceInfo = TTS_VOICES.find((item) => item.id === voice) || {
      id: voice,
      name: voice,
    };
    const speed = Math.max(
      0.5,
      Math.min(2, Number(options.speed) || ttsSettings.speed || 1),
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempWav = path.join(TTS_OUTPUTS, `.tts-${stamp}.wav`);
    const payload = {
      text: cleanedText,
      modelId: model.modelId || "onnx-community/Kokoro-82M-v1.0-ONNX",
      dtype: model.dtype || "q8",
      voice,
      speed,
      output: tempWav,
      cacheDir: TTS_CACHE,
    };

    const startedAt = Date.now();
    ttsGenerationState = {
      active: true,
      phase: "Loading voice model",
      progress: -1,
      done: 0,
      total: 0,
      startedAt,
      model: model.filename,
      voice,
      output: "",
    };
    const proc = spawn(process.execPath, [TTS_WORKER], {
      cwd: ROOT,
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        NODE_PATH: path.join(TTS_RUNTIME, "node_modules"),
        TTS_RUNTIME,
      },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    // The worker reports "@@progress {...}" lines on stderr; everything else is ordinary log output
    let stderrLine = "";
    proc.stderr.on("data", (data) => {
      stderrLine += data.toString();
      const lines = stderrLine.split("\n");
      stderrLine = lines.pop();
      for (const line of lines) {
        if (line.startsWith("@@progress ")) {
          try {
            const update = JSON.parse(line.slice("@@progress ".length));
            const total = Number(update.total) || 0;
            const done = Number(update.done) || 0;
            ttsGenerationState = {
              ...ttsGenerationState,
              phase:
                update.phase === "loading"
                  ? "Loading voice model"
                  : update.phase === "saving"
                    ? "Saving"
                    : "Generating speech",
              progress:
                update.phase === "loading" || total === 0
                  ? -1
                  : Math.min(99, Math.round((done / total) * 100)),
              done,
              total,
            };
          } catch (_) {}
          continue;
        }
        stderr += line + "\n";
        process.stderr.write("  [tts] " + line + "\n");
      }
    });
    proc.on("error", (err) => {
      ttsGenerationState = {
        active: false,
        phase: "Failed",
        progress: 0,
        model: model.filename,
        voice,
        output: "",
      };
      reject(err);
    });
    proc.on("exit", (code) => {
      // An error stack usually arrives without a trailing newline
      if (stderrLine) stderr += stderrLine;
      ttsGenerationState = {
        active: false,
        phase: code === 0 ? "Complete" : "Failed",
        progress: code === 0 ? 100 : 0,
        model: model.filename,
        voice,
        output: "",
      };
      if (code !== 0) {
        try {
          fs.unlinkSync(tempWav);
        } catch (_) {}
        const message = (
          stderr ||
          stdout ||
          `Il motore vocale Kokoro si è arrestato con codice ${code}`
        )
          .trim()
          .slice(-1400);
        ttsError = message;
        reject(new Error(message));
        return;
      }
      try {
        const workerResult = JSON.parse(stdout.trim() || "{}");
        if (!workerResult.ok || !fs.existsSync(tempWav)) {
          throw new Error(
            workerResult.error || "Kokoro non ha prodotto un file audio WAV.",
          );
        }
        const saved = saveTtsOutput({
          text: cleanedText,
          model: model.filename,
          modelName: model.name,
          voice,
          voiceName: voiceInfo.name,
          speed,
          // Length of the audio itself; older workers only let us time the generation
          durationMs: workerResult.durationMs || Date.now() - startedAt,
          sampleRate: workerResult.sampleRate || 24000,
          wavPath: tempWav,
          segments: workerResult.segments,
          displayName: `${voiceInfo.name || voice} - ${cleanedText.slice(0, 40)}`,
        });
        try {
          fs.unlinkSync(tempWav);
        } catch (_) {}
        ttsError = null;
        resolve(saved);
      } catch (err) {
        try {
          fs.unlinkSync(tempWav);
        } catch (_) {}
        ttsError = err.message || String(err);
        reject(err);
      }
    });
    proc.stdin.end(JSON.stringify(payload));
  });
}

function runExclusiveSpeechOperation(operation) {
  const run = llmOperationQueue.catch(() => {}).then(operation);
  llmOperationQueue = run.catch(() => {});
  return run;
}

async function startSpeech(settings = {}) {
  const backendPreference = normalizeSpeechBackendPreference(
    settings.backendPreference || speechSettings.backendPreference,
  );
  const backend = getSpeechBackend(backendPreference);
  if (!backend.cli) {
    throw new Error(
      `Il motore Whisper ${backend.label || "selezionato"} non è installato. Esegui la preparazione o chiedi al docente di copiare un eseguibile compatibile in ${backend.pathHint || "app/speech-backend"}.`,
    );
  }
  const model = resolveSpeechModel(settings.model);
  await killLlm();
  await stopTts();
  PORT_SPEECH = await findAvailableSpeechPort();
  speechError = null;
  speechReady = true;
  speechSettings = {
    ...speechSettings,
    model: model.filename,
    language: settings.language || speechSettings.language || "auto",
    threads: Math.max(
      1,
      Math.min(4, Number(settings.threads) || speechSettings.threads || 4),
    ),
    backendPreference,
    backendBinary: path.basename(backend.cli),
    backendMode: backend.mode,
  };
}

async function stopSpeech() {
  speechReady = false;
  speechError = null;
  speechTranscriptionState = {
    active: false,
    phase: "",
    progress: 0,
    model: "",
    filename: "",
  };
}

// Uploads arrive as 16 kHz mono WAV (the browser converts other formats), about 115 MB
// per hour, so 1 GB allows roughly 9 hours of audio.
function readBinaryBody(req, limitBytes = 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limitBytes) {
        reject(
          new Error(
            `File audio troppo grande. Il limite è ${Math.round(limitBytes / (1024 * 1024))} MB.`,
          ),
        );
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function isWaveBuffer(buffer) {
  return (
    buffer?.length > 44 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  );
}

function saveTranscript(result) {
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const base = `transcript-${stamp}-${safeOutputName(result.sourceFilename || "audio")}`;
  const textFilename = `${base}.txt`;
  const jsonFilename = `${base}.json`;
  fs.writeFileSync(
    path.join(TRANSCRIPTIONS, textFilename),
    result.text || "",
    "utf8",
  );
  const metadata = {
    ...result,
    createdAt,
    textFile: textFilename,
    metadata: jsonFilename,
  };
  fs.writeFileSync(
    path.join(TRANSCRIPTIONS, jsonFilename),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
  return metadata;
}

function listTranscriptions() {
  try {
    return readdirVisible(TRANSCRIPTIONS)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .map((file) => {
        const filePath = path.join(TRANSCRIPTIONS, file);
        try {
          const metadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
          const stat = fs.statSync(filePath);
          return {
            ...metadata,
            filename: file,
            displayName: metadata.sourceFilename || metadata.textFile || file,
            sizeBytes: stat.size,
            size: formatBytes(stat.size),
            modifiedAt: stat.mtime.toISOString(),
            createdAt: metadata.createdAt || stat.mtime.toISOString(),
            url: `/transcriptions/${encodeURIComponent(file)}`,
            textUrl: metadata.textFile
              ? `/transcriptions/${encodeURIComponent(metadata.textFile)}`
              : "",
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      );
  } catch (_) {
    return [];
  }
}

async function transcribeWavBuffer(buffer, options = {}) {
  await killLlm();
  return new Promise((resolve, reject) => {
    if (!isWaveBuffer(buffer)) {
      reject(
        new Error("La trascrizione accetta solo audio WAV. Carica il file dalla pagina Trascrivi per convertirlo."),
      );
      return;
    }
    const backendPreference = normalizeSpeechBackendPreference(
      options.backendPreference || speechSettings.backendPreference,
    );
    const backend = getSpeechBackend(backendPreference);
    if (!backend.cli) {
      reject(
        new Error(
          `Il motore Whisper ${backend.label || "selezionato"} non è installato.`,
        ),
      );
      return;
    }
    const model = resolveSpeechModel(options.model || speechSettings.model);
    const language = String(
      options.language || speechSettings.language || "auto",
    );
    const sourceFilename =
      safeOutputName(options.filename || "recording.wav") || "recording.wav";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tempBase = path.join(
      TRANSCRIPTIONS,
      `.speech-${stamp}-${sourceFilename.replace(/\.[^.]+$/, "")}`,
    );
    const wavPath = `${tempBase}.wav`;
    const outBase = `${tempBase}-out`;
    fs.writeFileSync(wavPath, buffer);

    speechTranscriptionState = {
      active: true,
      phase: "Transcribing audio...",
      progress: -1,
      model: model.filename,
      filename: sourceFilename,
    };

    const args = [
      "-ng",
      "-m",
      model.path,
      "-f",
      wavPath,
      "-otxt",
      "-oj",
      "-of",
      outBase,
      "-t",
      String(
        Math.max(
          1,
          Math.min(4, Number(options.threads) || speechSettings.threads || 4),
        ),
      ),
    ];
    if (language && language !== "auto") {
      args.push("-l", language);
    } else {
      args.push("-l", "auto");
    }
    if (options.translate) {
      args.push("-tr");
    }

    const startedAt = Date.now();
    console.log("  [speech] Starting:", backend.cli, args.join(" "));
    const proc = spawn(backend.cli, args, {
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        ...(osPlatform === "win32"
          ? {
              PATH:
                path.dirname(backend.cli) +
                (process.env.PATH ? `;${process.env.PATH}` : ""),
            }
          : {}),
        ...(osPlatform === "linux"
          ? {
              LD_LIBRARY_PATH:
                path.dirname(backend.cli) +
                (process.env.LD_LIBRARY_PATH
                  ? `:${process.env.LD_LIBRARY_PATH}`
                  : ""),
            }
          : {}),
        ...(osPlatform === "darwin"
          ? {
              DYLD_LIBRARY_PATH:
                path.dirname(backend.cli) +
                (process.env.DYLD_LIBRARY_PATH
                  ? `:${process.env.DYLD_LIBRARY_PATH}`
                  : ""),
            }
          : {}),
      },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
      process.stdout.write("  [speech] " + data.toString());
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
      process.stderr.write("  [speech-err] " + data.toString());
    });
    proc.on("exit", (code) => {
      try {
        fs.unlinkSync(wavPath);
      } catch (_) {}
      speechTranscriptionState = {
        active: false,
        phase: code === 0 ? "Complete" : "Failed",
        progress: code === 0 ? 100 : 0,
        model: model.filename,
        filename: sourceFilename,
      };
      if (code !== 0) {
        const message = (
          stderr ||
          stdout ||
          `whisper.cpp exited with code ${code}`
        )
          .trim()
          .slice(-1200);
        speechError = message;
        reject(new Error(message));
        return;
      }
      const txtPath = `${outBase}.txt`;
      const jsonPath = `${outBase}.json`;
      const text = fs.existsSync(txtPath)
        ? fs.readFileSync(txtPath, "utf8").trim()
        : stdout.trim();
      let raw = null;
      try {
        raw = fs.existsSync(jsonPath)
          ? JSON.parse(fs.readFileSync(jsonPath, "utf8"))
          : null;
      } catch (_) {}
      try {
        fs.unlinkSync(txtPath);
      } catch (_) {}
      try {
        fs.unlinkSync(jsonPath);
      } catch (_) {}
      // Dictation (the Voice screen's mic) only wants the text, not a saved transcript
      if (options.save === false) {
        speechError = null;
        resolve({
          text,
          model: model.filename,
          language,
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      const saved = saveTranscript({
        text,
        model: model.filename,
        modelName: model.name,
        language,
        backend: backend.key,
        backendMode: backend.mode,
        sourceFilename,
        durationMs: Date.now() - startedAt,
        raw,
      });
      speechError = null;
      resolve(saved);
    });
  });
}

function pingLlmReady(expectedModel = "") {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT_LLM}/v1/models`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 500) {
          resolve(false);
          return;
        }
        if (!expectedModel) {
          resolve(true);
          return;
        }
        try {
          const parsed = JSON.parse(body || "{}");
          const servedIds = Array.isArray(parsed.data)
            ? parsed.data.map((item) => String(item.id || item.model || ""))
            : [];
          const expectedBase = path.basename(expectedModel).toLowerCase();
          resolve(
            servedIds.some((id) => {
              const lower = id.toLowerCase();
              return lower === expectedBase || lower.includes(expectedBase);
            }),
          );
        } catch (_) {
          resolve(false);
        }
      });
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForLlmReady(
  maxAttempts = 240,
  expectedProc = llmProc,
  expectedModel = "",
) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!expectedProc || llmProc !== expectedProc)
      throw new Error(llmError || "Il motore chat llama.cpp si è arrestato durante l’avvio.");
    if (await pingLlmReady(expectedModel)) {
      llmReady = true;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Il motore chat llama.cpp non si è avviato entro ${Math.round(maxAttempts / 120)} minuti.`,
  );
}

function waitForChildExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true);
      return;
    }
    let done = false;
    const finish = (exited) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      proc.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    proc.once("exit", onExit);
  });
}

async function killLlm() {
  llmReady = false;
  llmSettings.supportsVision = false;
  llmSettings.visionMode = "none";
  llmSettings.visionStatus = "Proiettore non caricato";
  llmSettings.mmproj = null;
  if (!llmProc) {
    await waitForPortAvailable(PORT_LLM, 1500);
    return;
  }

  const proc = llmProc;
  const procPort = PORT_LLM;
  llmProc = null;

  try {
    proc.kill("SIGTERM");
  } catch (_) {}
  const exitedAfterTerm = await waitForChildExit(proc, 2500);
  if (!exitedAfterTerm) {
    try {
      proc.kill("SIGKILL");
    } catch (_) {}
    await waitForChildExit(proc, 2500);
  }

  const released = await waitForPortAvailable(procPort, 5000);
  if (!released) {
    console.warn(
      `  [llm] Port ${procPort} is still busy after stopping llama.cpp.`,
    );
  }
}

async function getHealth() {
  const checks = [
    getPathInfo("Interfaccia", path.join(DIST, "index.html")),
    getDirInfo("Modelli chat", LLM_MODELS),
    getDirInfo("Conversazioni", CHAT_HISTORY),
  ];
  const text = getLlmBackendProbe().selected;
  const speech = getSpeechBackend();
  const tts = getTtsRuntimeStatus();
  const issues = checks
    .filter((c) => !c.ok)
    .map((c) => c.label + ": mancante o non scrivibile.");
  if (!text) issues.push("Motore chat CPU non installato: eseguire il setup.");
  return {
    ok: checks.every((c) => c.ok) && Boolean(text),
    build: SERVER_BUILD,
    root: ROOT,
    platform: osPlatform,
    checks,
    issues,
    text: { installed: Boolean(text), ready: llmReady },
    speech: { installed: Boolean(speech.cli), ready: speechReady },
    tts: { runtimeInstalled: tts.installed, ready: ttsReady },
    features: {
      chat: true,
      documents: true,
      speech: true,
      tts: true,
      images: false,
      webSearch: false,
      paidApis: false,
    },
  };
}

function getCleanupCandidates() {
  return [];
}

function cleanupSelected(ids = []) {
  const allowed = new Map(
    getCleanupCandidates().map((candidate) => [candidate.id, candidate]),
  );
  const deleted = [];
  for (const id of ids) {
    const candidate = allowed.get(id);
    if (!candidate) continue;
    if (!fs.existsSync(candidate.path)) continue;
    const stat = fs.statSync(candidate.path);
    if (stat.isDirectory()) {
      fs.rmSync(candidate.path, { recursive: true, force: true });
    } else {
      fs.unlinkSync(candidate.path);
    }
    deleted.push(candidate);
  }
  return deleted;
}

// to Linux. Vulkan hardware passthrough is only supported for NVIDIA (via CUDA).

function requestJson(url, payload = null, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = payload ? Buffer.from(JSON.stringify(payload), "utf8") : null;
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: data ? "POST" : "GET",
        headers: data
          ? {
              "Content-Type": "application/json",
              "Content-Length": data.length,
            }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const jsonBody = JSON.parse(body || "{}");
            if (
              res.statusCode < 200 ||
              res.statusCode >= 300 ||
              jsonBody.ok === false
            ) {
              reject(new Error(jsonBody.error || `HTTP ${res.statusCode}`));
              return;
            }
            resolve(jsonBody);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Tempo di attesa della richiesta scaduto")));
    if (data) req.write(data);
    req.end();
  });
}

function buildLlmLoadProfiles(settings = {}) {
  const size = Math.max(
    512,
    Math.min(2048, Number(settings.contextSize) || 2048),
  );
  return [
    { name: "school", contextSize: size, gpuLayers: 0 },
    ...(size > 1024
      ? [{ name: "low-memory", contextSize: 1024, gpuLayers: 0 }]
      : []),
  ];
}

// Architectures that GGUF files can declare but llama.cpp has never implemented.
// Updating the backend cannot fix these, so fail early with a clear message.
const LLAMA_CPP_UNSUPPORTED_ARCHITECTURES = {
  mllama:
    "I modelli visivi non sono disponibili nel profilo scolastico. Scegli un GGUF di testo consigliato.",
};

function readGgufArchitecture(modelPath) {
  let fd = null;
  try {
    fd = fs.openSync(modelPath, "r");
    const buf = Buffer.alloc(64 * 1024);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    if (bytes < 24 || buf.toString("latin1", 0, 4) !== "GGUF") return "";
    let kvCount = Number(buf.readBigUInt64LE(16));
    let offset = 24;
    const readString = () => {
      const len = Number(buf.readBigUInt64LE(offset));
      offset += 8;
      if (len > 4096 || offset + len > bytes)
        throw new Error("metadata exceeds header window");
      const value = buf.toString("utf8", offset, offset + len);
      offset += len;
      return value;
    };
    // GGUF value type sizes for fixed-width scalar types; 8 = string.
    const scalarSize = {
      0: 1,
      1: 1,
      2: 2,
      3: 2,
      4: 4,
      5: 4,
      6: 4,
      7: 1,
      10: 8,
      11: 8,
      12: 8,
    };
    while (kvCount-- > 0) {
      const key = readString();
      const type = buf.readUInt32LE(offset);
      offset += 4;
      if (type === 8) {
        const value = readString();
        if (key === "general.architecture") return value;
      } else if (scalarSize[type]) {
        offset += scalarSize[type];
      } else {
        return ""; // arrays and unknown types: give up, let llama.cpp report it
      }
    }
  } catch (_) {
    // Unreadable header: let llama.cpp produce its own error.
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (_) {}
    }
  }
  return "";
}

async function startLlm(settings = {}) {
  const filename = path.basename(String(settings.model || ""));
  const modelPath = path.join(LLM_MODELS, filename);
  if (
    !filename ||
    !pathInside(modelPath, LLM_MODELS) ||
    !fs.existsSync(modelPath)
  ) {
    throw new Error("Scegli prima un modello di testo GGUF scaricato.");
  }
  if (!filename.toLowerCase().endsWith(".gguf")) {
    throw new Error("La generazione di testo richiede un modello .gguf.");
  }

  const architecture = readGgufArchitecture(modelPath).toLowerCase();
  if (LLAMA_CPP_UNSUPPORTED_ARCHITECTURES[architecture]) {
    throw new Error(
      `${filename}: ${LLAMA_CPP_UNSUPPORTED_ARCHITECTURES[architecture]}`,
    );
  }

  const candidates = getLlmBackendCandidates();
  if (candidates.length === 0) {
    throw new Error(
      "Il motore chat llama.cpp non è installato. Esegui la preparazione per il tuo sistema operativo.",
    );
  }
  const persistedSettings = getLlmModelSettings(filename);
  const preferredBackend = String(
    settings.preferredBackend || persistedSettings.preferredBackend || "",
  ).toLowerCase();
  const sortedCandidates = preferredBackend
    ? [...candidates].sort((a, b) => {
        if (a.key === preferredBackend && b.key !== preferredBackend) return -1;
        if (b.key === preferredBackend && a.key !== preferredBackend) return 1;
        return 0;
      })
    : candidates;

  const failures = [];
  for (const backend of sortedCandidates) {
    for (const profile of buildLlmLoadProfiles(settings, backend)) {
      try {
        await startLlmWithBackend(
          { ...settings, __loadProfile: profile },
          backend,
        );
        llmSettings.backendFallbacks = failures;
        updateLlmModelSettings(filename, {
          // Only pin the backend when the first choice worked; a CPU fallback after a
          // failed GPU start must not become the permanent preference.
          ...(failures.length === 0 ? { preferredBackend: backend.key } : {}),
          lastBackendMode: llmSettings.backendMode,
          lastBackendBinary: llmSettings.backendBinary,
          lastSettings: {
            threads: llmSettings.threads,
            contextSize: llmSettings.contextSize,
            gpuLayers: llmSettings.gpuLayers,
            cacheTypeK: llmSettings.cacheTypeK,
            cacheTypeV: llmSettings.cacheTypeV,
            batchSize: llmSettings.batchSize,
            ubatchSize: llmSettings.ubatchSize,
            flashAttn: llmSettings.flashAttn,
          },
        });
        return;
      } catch (err) {
        const message = err.message || String(err);
        failures.push({
          backend: backend.mode,
          binary: path.basename(backend.path),
          profile: profile.name,
          error: message.slice(-500),
        });
        console.warn(
          `  [llm] Load failed on ${backend.mode} (${profile.name}): ${message}`,
        );
        await killLlm();
      }
    }
  }

  const last = failures[failures.length - 1];
  llmSettings.backendFallbacks = failures;
  throw new Error(
    `Impossibile avviare il modello con i motori disponibili. Ultimo errore: ${last?.error || "errore sconosciuto"}`,
  );
}

// Older llama.cpp builds take --mmap/--mlock; newer ones only --load-mode. Read the
// binary's --help once per path to know which it understands.
const llamaServerHelpCache = new Map();
function llamaServerSupportsFlag(binaryPath, flag) {
  if (!llamaServerHelpCache.has(binaryPath)) {
    let help = "";
    try {
      const result = spawnSync(binaryPath, ["--help"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 4 * 1024 * 1024,
      });
      help = `${result.stdout || ""}\n${result.stderr || ""}`;
    } catch (_) {}
    llamaServerHelpCache.set(binaryPath, help);
  }
  return llamaServerHelpCache.get(binaryPath).includes(flag);
}

async function startLlmWithBackend(settings = {}, backend) {
  const filename = path.basename(String(settings.model || ""));
  const modelPath = path.join(LLM_MODELS, filename);
  if (
    !filename ||
    !filename.endsWith(".gguf") ||
    !pathInside(modelPath, LLM_MODELS) ||
    !fs.existsSync(modelPath)
  )
    throw new Error("Scegli un modello GGUF di testo installato.");
  if (fs.statSync(modelPath).size > 2 * 1024 ** 3)
    throw new Error(
      "Il modello supera il limite scolastico di 2 GB. Scegli un modello più piccolo.",
    );
  if (
    detectModelKindCached(modelPath).kind !== "text" ||
    /vision|mmproj|llava|qwen.*vl|smolvlm|moondream/i.test(filename)
  )
    throw new Error(
      "Questa versione utilizza solo modelli di testo, senza proiettori o modelli di immagini.",
    );
  if (!backend) throw new Error("Motore chat CPU mancante. Esegui il setup.");
  await stopSpeech();
  await stopTts();
  await killLlm();
  PORT_LLM = await findAvailableLlmPort();
  llmError = null;
  llmSettings = {
    ...llmSettings,
    model: filename,
    threads: Math.max(1, Math.min(4, Number(settings.threads) || 4)),
    contextSize: Math.max(
      512,
      Math.min(
        2048,
        Number(settings.__loadProfile?.contextSize ?? settings.contextSize) ||
          2048,
      ),
    ),
    gpuLayers: 0,
    backendMode: "CPU",
    backendBinary: path.basename(backend.path),
    supportsVision: false,
    visionMode: "none",
    supportsThinking: false,
    enableThinking: false,
    mlock: false,
    mmap: true,
    batchSize: 128,
    ubatchSize: 128,
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
  };
  const args = [
    "--model",
    modelPath,
    "--host",
    "127.0.0.1",
    "--port",
    String(PORT_LLM),
    "--ctx-size",
    String(llmSettings.contextSize),
    "--threads",
    String(llmSettings.threads),
    "--n-gpu-layers",
    "0",
    "--parallel",
    "1",
    "--batch-size",
    "128",
    "--ubatch-size",
    "128",
    "--poll",
    "0",
  ];
  if (llamaServerSupportsFlag(backend.path, "--load-mode"))
    args.push("--load-mode", "mmap");
  const spawnEnv = { ...process.env };
  const backendDir = path.dirname(backend.path);
  if (osPlatform === "linux")
    spawnEnv.LD_LIBRARY_PATH =
      backendDir +
      (spawnEnv.LD_LIBRARY_PATH ? ":" + spawnEnv.LD_LIBRARY_PATH : "");
  if (osPlatform === "darwin")
    spawnEnv.DYLD_LIBRARY_PATH =
      backendDir +
      (spawnEnv.DYLD_LIBRARY_PATH ? ":" + spawnEnv.DYLD_LIBRARY_PATH : "");
  console.log("  [llm] Starting:", backend.path, args.join(" "));
  const proc = spawn(backend.path, args, { stdio: "pipe", env: spawnEnv });
  const procSeq = ++llmProcSeq;
  llmProc = proc;
  proc.stdout.on("data", (data) => {
    if (llmProc !== proc) return;
    process.stdout.write("  [llm] " + data.toString());
  });
  proc.stderr.on("data", (data) => {
    if (llmProc !== proc) return;
    const output = data.toString();
    process.stderr.write("  [llm-err] " + output);
    if (/error|failed/i.test(output) && !/no error/i.test(output)) {
      llmError = output.trim().slice(-1200);
      const unknownArch = output.match(
        /unknown model architecture:\s*'([^']+)'/i,
      );
      if (unknownArch) {
        llmError =
          `${LLAMA_CPP_UNSUPPORTED_ARCHITECTURES[unknownArch[1].toLowerCase()] || `Questa versione di llama.cpp non supporta l’architettura '${unknownArch[1]}'. Ripeti la preparazione per aggiornare il motore o scegli un altro modello.`}\n${llmError}`.slice(
            -1400,
          );
      }
    }
  });
  proc.on("exit", (code) => {
    if (llmProc !== proc) {
      console.log("  [llm] stale process exited with code", code);
      return;
    }
    llmReady = false;
    llmProc = null;
    if (code !== 0 && code !== null && !llmError)
      llmError = `Il motore chat llama.cpp si è arrestato con codice ${code}`;
    console.log("  [llm] exited with code", code, `(process ${procSeq})`);
  });

  await waitForLlmReady(backend.key === "cpu" ? 720 : 360, proc, filename);
}

// ── Model Downloader ─────────────────────────────────────────────────────────
let downloadState = {
  active: false,
  filename: "",
  progress: 0,
  speed: "0 MB/s",
  eta: 0,
  totalBytes: 0,
  downloadedBytes: 0,
  error: null,
};
let activeDownload = null;

// ── Generation State (Real-time progress parser) ─────────────────────────────

function describeDownloadHttpError(statusCode, url, headers = {}) {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return "";
    }
  })();
  const isHuggingFace =
    host.includes("huggingface.co") || host.includes("hf.co");
  const hfErrorCode = headers["x-error-code"];
  const hfErrorMessage = headers["x-error-message"];

  if (isHuggingFace && hfErrorCode === "GatedRepo") {
    return `HTTP ${statusCode}: questo modello su Hugging Face ha accesso limitato. Scegli un modello gratuito del catalogo oppure chiedi al docente di verificare le condizioni di accesso.`;
  }
  if (isHuggingFace && hfErrorMessage) {
    return `HTTP ${statusCode}: Hugging Face ha rifiutato lo scaricamento: ${hfErrorMessage}`;
  }

  if (statusCode === 401 || statusCode === 403) {
    return isHuggingFace
      ? `HTTP ${statusCode}: Hugging Face ha rifiutato lo scaricamento. Riavvia l’app e riprova; se il problema continua, chiedi al docente di verificare l’accesso al modello.`
      : `HTTP ${statusCode}: questo indirizzo richiede un’autorizzazione. Usa un collegamento pubblico diretto al file.`;
  }
  if (statusCode === 404) {
    return `HTTP 404: file del modello non trovato. Verifica che l’indirizzo punti direttamente al file del modello.`;
  }
  return `HTTP ${statusCode}`;
}

const MODEL_FILE_URL_HINT =
  "Usa un collegamento diretto a un file .gguf o .bin su Hugging Face.";

// Rejects URLs that point at a web page instead of a downloadable file, e.g. a
// Hugging Face repository page, which otherwise "downloads" as a small HTML file.

function startModelDownload(
  url,
  overrideFilename = null,
  targetDir = LLM_MODELS,
  kind = "text",
  redirectCount = 0,
) {
  if (downloadState.active && !overrideFilename) {
    console.log("  [download] Already downloading a model");
    return;
  }

  // Convert HuggingFace viewer URL (/blob/) to direct download URL (/resolve/)
  if (url.includes("huggingface.co") && url.includes("/blob/")) {
    url = url.replace("/blob/", "/resolve/");
  }

  let filename = overrideFilename;
  if (!filename) {
    filename = "model.gguf";
    try {
      const parsed = new URL(url);
      filename = path.basename(parsed.pathname);
    } catch (e) {
      console.error("Failed to parse URL filename:", e);
    }
  }

  const destPath = path.join(targetDir, filename);
  const tempPath = `${destPath}.part`;
  try {
    fs.unlinkSync(tempPath);
  } catch (_) {}
  downloadState = {
    active: true,
    filename: filename,
    progress: 0,
    speed: "0 MB/s",
    eta: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    error: null,
    kind,
  };

  if (redirectCount > 0) {
    console.log(`  [download] Continuing redirected download of ${filename}`);
  } else {
    console.log(`  [download] Starting download of ${filename} from ${url}`);
  }

  let downloadFinalized = false;
  const failDownload = (message, err = null) => {
    if (downloadFinalized) return;
    downloadFinalized = true;
    downloadState.active = false;
    downloadState.error = message;
    if (err) {
      console.error("  [download]", message, err);
    } else {
      console.error("  [download] Failed:", message);
    }
    try {
      fileStream.close();
    } catch (_) {}
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
    activeDownload = null;
  };

  const fileStream = fs.createWriteStream(tempPath);
  fileStream.on("error", (err) => {
    failDownload(`Impossibile scrivere ${filename}: ${err.message}`, err);
  });

  const client = url.startsWith("https") ? https : http;
  const request = client.get(
    url,
    {
      headers: {
        "User-Agent":
          "Uncensored-AI-Studio/1.0 (+https://github.com/techjarves/Uncensored-AI-Studio)",
        Accept: "application/octet-stream, application/x-safetensors, */*",
        Referer: "https://huggingface.co/",
      },
    },
    (response) => {
      activeDownload = { request, fileStream, destPath, tempPath };
      // Handle redirects (HuggingFace resolve URLs redirect to Cloudfront/S3)
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const redirectUrl = response.headers.location
          ? new URL(response.headers.location, url).toString()
          : "";
        if (!redirectUrl) {
          failDownload("Il server di scaricamento non ha indicato l’indirizzo di destinazione");
          return;
        }
        if (redirectCount > 10) {
          failDownload("Troppi reindirizzamenti durante lo scaricamento");
          return;
        }
        console.log(`  [download] Connessione all’indirizzo di scaricamento for ${filename}`);
        downloadState.speed = "Connessione all’indirizzo di scaricamento";

        // Clean up redirected request to avoid triggering error handlers later
        request.removeAllListeners("error");
        request.destroy();
        response.resume();

        fileStream.close();
        try {
          fs.unlinkSync(tempPath);
        } catch (_) {}
        activeDownload = null;
        startModelDownload(
          redirectUrl,
          filename,
          targetDir,
          kind,
          redirectCount + 1,
        );
        return;
      }

      if (response.statusCode !== 200) {
        failDownload(
          describeDownloadHttpError(response.statusCode, url, response.headers),
        );
        return;
      }

      // Repository pages, login walls and error pages come back as 200 + text/html.
      if (
        String(response.headers["content-type"] || "")
          .toLowerCase()
          .includes("text/html")
      ) {
        response.resume();
        failDownload(
          `L’indirizzo ha restituito una pagina web invece di un file del modello. ${MODEL_FILE_URL_HINT}`,
        );
        return;
      }

      const totalBytes = parseInt(response.headers["content-length"], 10) || 0;
      downloadState.totalBytes = totalBytes;
      let downloadedBytes = 0;
      let startTime = Date.now();
      let lastTime = startTime;
      let lastDownloaded = 0;

      response.on("data", (chunk) => {
        downloadedBytes += chunk.length;
        downloadState.downloadedBytes = downloadedBytes;
        // Wait for the disk to catch up so slow drives (USB sticks) don't buffer the whole file in memory
        if (!fileStream.write(chunk)) {
          response.pause();
          fileStream.once("drain", () => response.resume());
        }

        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed >= 0.5) {
          const chunkSpeed = (downloadedBytes - lastDownloaded) / elapsed; // bytes/sec
          lastDownloaded = downloadedBytes;
          lastTime = now;

          const speedMb = (chunkSpeed / (1024 * 1024)).toFixed(1);
          downloadState.speed = `${speedMb} MB/s`;

          if (totalBytes > 0) {
            downloadState.progress = Math.round(
              (downloadedBytes / totalBytes) * 100,
            );
            const remainingBytes = totalBytes - downloadedBytes;
            downloadState.eta = Math.round(remainingBytes / chunkSpeed);
          } else {
            downloadState.progress = -1; // Indeterminate
            downloadState.eta = -1;
          }
        }
      });

      response.on("aborted", () => {
        failDownload(
          `Scaricamento di ${filename} interrotto. Riprova a scaricare il modello.`,
        );
      });

      response.on("error", (err) => {
        failDownload(
          `Errore durante lo scaricamento di ${filename}. Riprova a scaricare il modello.`,
          err,
        );
      });

      response.on("end", () => {
        if (downloadFinalized) return;
        if (totalBytes > 0 && downloadedBytes !== totalBytes) {
          failDownload(
            `Scaricamento di ${filename} incompleto: ricevuti ${formatBytes(downloadedBytes)} su ${formatBytes(totalBytes)}. Riprova a scaricare il modello.`,
          );
          return;
        }

        fileStream.end(() => {
          try {
            if (totalBytes > 0) {
              const writtenBytes = fs.statSync(tempPath).size;
              if (writtenBytes !== totalBytes) {
                failDownload(
                  `Salvataggio di ${filename} incompleto: scritti ${formatBytes(writtenBytes)} su ${formatBytes(totalBytes)}. Riprova a scaricare il modello.`,
                );
                return;
              }
            }
            replaceFileWithRetry(tempPath, destPath);

            if (destPath.toLowerCase().endsWith(".zip")) {
              try {
                const { execSync } = require("child_process");
                execSync(
                  `unzip -o "${destPath}" -d "${path.dirname(destPath)}"`,
                  { stdio: "ignore" },
                );
                fs.unlinkSync(destPath);
              } catch (err) {
                console.error("Failed to unzip", err);
              }
            }

            downloadState.active = false;
            downloadFinalized = true;
            downloadState.progress = 100;
            downloadState.downloadedBytes = downloadedBytes;
            downloadState.error = null;
            activeDownload = null;
            console.log(`  [download] Completed download of ${filename}`);
          } catch (err) {
            failDownload(`Impossibile completare il salvataggio di ${filename}: ${err.message}`);
          }
        });
      });
    },
  );

  request.on("error", (err) => {
    failDownload(err.message, err);
  });
  activeDownload = { request, fileStream, destPath, tempPath };
}

function cancelModelDownload() {
  if (!downloadState.active) {
    return false;
  }
  const filename = downloadState.filename;
  if (activeDownload) {
    if (activeDownload.process) {
      try {
        activeDownload.process.kill("SIGTERM");
      } catch (_) {}
      setTimeout(() => {
        try {
          activeDownload?.process?.kill("SIGKILL");
        } catch (_) {}
      }, 1000);
    } else {
      try {
        activeDownload.request.destroy(new Error("Scaricamento annullato dall’utente"));
      } catch (_) {}
      try {
        activeDownload.fileStream.destroy();
      } catch (_) {}
      try {
        fs.unlinkSync(activeDownload.tempPath || activeDownload.destPath);
      } catch (_) {}
    }
  } else if (filename) {
    const targetDir =
      downloadState.kind === "text"
        ? LLM_MODELS
        : downloadState.kind === "speech"
          ? SPEECH_MODELS
          : downloadState.kind === "tts"
            ? TTS_MODELS
            : LLM_MODELS;
    try {
      fs.unlinkSync(`${path.join(targetDir, filename)}.part`);
    } catch (_) {}
  }
  activeDownload = null;
  downloadState = {
    active: false,
    filename,
    progress: 0,
    speed: "0 MB/s",
    eta: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    error: "Scaricamento annullato",
    kind: downloadState.kind || "text",
  };
  console.log(`  [download] Cancelled download of ${filename}`);
  return true;
}

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".txt": "text/plain",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_JSON_BODY_BYTES) {
        reject(
          new Error(
            `Richiesta troppo grande. Il limite è ${Math.round(MAX_JSON_BODY_BYTES / (1024 * 1024))} MB.`,
          ),
        );
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(new Error("La richiesta contiene dati JSON non validi"));
      }
    });
    req.on("error", reject);
  });
}

async function readJsonBody(req, res) {
  try {
    return await readBody(req);
  } catch (err) {
    json(res, err.message.includes("too large") ? 413 : 400, {
      ok: false,
      error: err.message,
    });
    return null;
  }
}

function safeOutputName(value) {
  return String(value || "")
    .replace(/[^a-z0-9._-]/gi, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}

function sanitizeChatMessageForStorage(message) {
  if (!message || typeof message !== "object") return null;
  const role = String(message.role || "").trim();
  if (!["system", "user", "assistant"].includes(role)) return null;
  let content = message.content;
  if (Array.isArray(content)) {
    content = content.map((item) => {
      if (!item || typeof item !== "object") return item;
      if (item.type === "image_url") {
        return {
          type: "text",
          text: "[Attached image omitted from saved chat history]",
        };
      }
      return item;
    });
  } else if (typeof content !== "string") {
    content = content === undefined || content === null ? "" : String(content);
  }
  return {
    ...message,
    role,
    content,
  };
}

function sanitizeChatConversationForStorage(conversation = {}) {
  const now = Date.now();
  const id = safeOutputName(conversation.id || `chat_${now}`) || `chat_${now}`;
  const messages = Array.isArray(conversation.messages)
    ? conversation.messages.map(sanitizeChatMessageForStorage).filter(Boolean)
    : [];
  const timestamp = Number(conversation.timestamp) || now;
  return {
    id,
    title: String(conversation.title || "Chat Session").slice(0, 160),
    model: String(conversation.model || ""),
    messages,
    timestamp,
    createdAt: conversation.createdAt || new Date(timestamp).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getChatConversationPath(id) {
  const safeId = safeOutputName(id);
  if (!safeId) throw new Error("Manca l’identificativo della conversazione.");
  const filePath = path.join(CHAT_HISTORY, `${safeId}.json`);
  if (!pathInside(filePath, CHAT_HISTORY)) {
    throw new Error("Identificativo della conversazione non valido.");
  }
  return filePath;
}

function saveChatConversation(conversation = {}) {
  const saved = sanitizeChatConversationForStorage(conversation);
  const filePath = getChatConversationPath(saved.id);
  fs.writeFileSync(filePath, JSON.stringify(saved, null, 2), "utf8");
  return saved;
}

function listChatConversations() {
  try {
    return readdirVisible(CHAT_HISTORY)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .map((file) => {
        try {
          const filePath = path.join(CHAT_HISTORY, file);
          if (!pathInside(filePath, CHAT_HISTORY)) return null;
          const conversation = JSON.parse(fs.readFileSync(filePath, "utf8"));
          const stat = fs.statSync(filePath);
          return {
            ...conversation,
            filename: file,
            modifiedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size,
            size: formatBytes(stat.size),
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  } catch (_) {
    return [];
  }
}

function deleteChatConversation(id) {
  const filePath = getChatConversationPath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

function streamModelUpload(
  req,
  filename,
  targetDir = LLM_MODELS,
  mode = "text",
) {
  return new Promise((resolve, reject) => {
    const safeFilename = path.basename(filename || "");
    const lowerName = safeFilename.toLowerCase();
    const valid =
      mode === "text"
        ? lowerName.endsWith(".gguf")
        : mode === "speech"
          ? lowerName.endsWith(".bin")
          : mode === "tts"
            ? lowerName.endsWith(".json")
            : false;
    if (!safeFilename || !valid) {
      reject(
        new Error(
          mode === "text"
            ? "Il nome del file deve terminare con .gguf"
            : mode === "speech"
              ? "Il nome del file deve terminare con .bin"
              : mode === "tts"
                ? "Il nome del file deve terminare con .json"
                : "Il nome del file deve terminare con .gguf, .safetensors o .ckpt",
        ),
      );
      return;
    }

    const limitBytes =
      mode === "text"
        ? 2 * 1024 ** 3
        : mode === "speech"
          ? 200 * 1024 ** 2
          : 1024 ** 2;
    if (Number(req.headers?.["content-length"]) > limitBytes) {
      reject(new Error("File troppo grande per il profilo scolastico."));
      return;
    }
    const destPath = path.join(targetDir, safeFilename);
    const tempPath = `${destPath}.part`;
    try {
      ensureStorageCapacity(targetDir, req.headers?.["content-length"]);
    } catch (err) {
      reject(new Error(describeStorageError(err, destPath)));
      return;
    }

    let fileDescriptor;
    try {
      fileDescriptor = withFileRetrySync(() => fs.openSync(tempPath, "w"));
    } catch (err) {
      reject(new Error(describeStorageError(err, tempPath)));
      return;
    }
    const out = fs.createWriteStream(tempPath, {
      fd: fileDescriptor,
      autoClose: true,
    });
    let finished = false;

    const cleanupPartial = () => {
      if (finished) return;
      out.destroy();
      try {
        fs.unlinkSync(tempPath);
      } catch (_) {}
    };

    req.pipe(out);
    req.on("error", (err) => {
      cleanupPartial();
      reject(err);
    });
    req.on("aborted", () => {
      cleanupPartial();
      reject(new Error("Importazione annullata dall’utente"));
    });
    req.on("close", () => {
      if (!finished && req.aborted) {
        cleanupPartial();
      }
    });
    out.on("error", (err) => {
      cleanupPartial();
      reject(new Error(describeStorageError(err, tempPath)));
    });
    out.on("finish", () => {
      try {
        finished = true;
        replaceFileWithRetry(tempPath, destPath);
        console.log(`  [api] Imported model file: ${safeFilename}`);
        if (mode === "text" || mode === "speech") {
          const stats = fs.statSync(destPath);
          resolve({
            filename: safeFilename,
            name: safeFilename,
            sizeBytes: stats.size,
            size: formatBytes(stats.size),
            format: mode === "speech" ? "Whisper GGML" : "GGUF",
          });
        } else {
          resolve({
            filename: safeFilename,
            sizeBytes: fs.statSync(destPath).size,
          });
        }
      } catch (err) {
        try {
          fs.unlinkSync(tempPath);
        } catch (_) {}
        reject(new Error(describeStorageError(err, destPath)));
      }
    });
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST",
    });
    res.end();
    return;
  }

  // ── Management API ────────────────────────────────────────────────────────
  // GET /api/health
  if (req.url === "/api/health" && req.method === "GET") {
    return json(res, 200, await getHealth());
  }

  // GET /api/diagnostics
  if (req.url === "/api/diagnostics" && req.method === "GET") {
    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      health: await getHealth(),
      cleanupCandidates: getCleanupCandidates(),
      download: downloadState,
      llm: {
        ready: llmReady,
        running: llmProc !== null,
        error: llmError,
        settings: llmSettings,
        port: PORT_LLM,
      },
      speech: {
        ready: speechReady,
        error: speechError,
        settings: speechSettings,
        backend: getSpeechBackend(),
        transcription: speechTranscriptionState,
      },
      hardware: getHardwareSpecs(),
      telemetry: getTelemetry(),
    });
  }

  // GET /api/cleanup-candidates
  if (req.url === "/api/cleanup-candidates" && req.method === "GET") {
    return json(res, 200, { candidates: getCleanupCandidates() });
  }

  // POST /api/cleanup
  if (req.url === "/api/cleanup" && req.method === "POST") {
    try {
      const body = await readJsonBody(req, res);
      if (!body) return;
      const deleted = cleanupSelected(Array.isArray(body.ids) ? body.ids : []);
      return json(res, 200, { ok: true, deleted });
    } catch (err) {
      console.error("  [api] Cleanup failed:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/backend-status

  if (req.url === "/api/llm/status" && req.method === "GET") {
    const backend = getLlmBackend();
    const probe = getLlmBackendProbe();
    return json(res, 200, {
      ready: llmReady,
      running: llmProc !== null,
      port: PORT_LLM,
      preferredPort: PREFERRED_LLM_PORT,
      error: llmError,
      settings: llmSettings,
      backendInstalled: Boolean(backend),
      backendMode: backend?.mode || "",
      backendPath: backend?.path || "",
      selectedBackend: probe.selected,
      availableBackends: probe.available,
    });
  }

  if (req.url.startsWith("/api/llm/backends") && req.method === "GET") {
    const parsed = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`,
    );
    return json(res, 200, {
      ok: true,
      ...getLlmBackendProbe(parsed.searchParams.get("refresh") === "1"),
    });
  }

  if (req.url === "/api/llm/model-settings" && req.method === "GET") {
    return json(res, 200, { ok: true, ...getPersistedLlmModelSettings() });
  }

  if (req.url === "/api/llm/model-settings" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.model || ""));
    if (!filename)
      return json(res, 400, { ok: false, error: "Occorre specificare un modello" });
    const updated = updateLlmModelSettings(filename, {
      preferredBackend: body.preferredBackend
        ? String(body.preferredBackend).toLowerCase()
        : undefined,
    });
    return json(res, 200, { ok: true, model: filename, settings: updated });
  }

  if (req.url === "/api/llm/conversations" && req.method === "GET") {
    return json(res, 200, { ok: true, conversations: listChatConversations() });
  }

  if (req.url === "/api/llm/save-conversation" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const conversation = saveChatConversation(body.conversation || body);
      return json(res, 200, { ok: true, conversation });
    } catch (err) {
      console.error("  [api] Failed to save chat conversation:", err);
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url === "/api/llm/delete-conversation" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const deleted = deleteChatConversation(body.id);
      return json(res, 200, { ok: true, deleted });
    } catch (err) {
      console.error("  [api] Failed to delete chat conversation:", err);
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url === "/api/llm/models" && req.method === "GET") {
    return json(res, 200, { models: getLlmModels() });
  }

  if (req.url === "/api/llm/start" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      await runExclusiveLlmOperation(() => startLlm(body));
      return json(res, 200, {
        ok: true,
        ready: llmReady,
        port: PORT_LLM,
        settings: llmSettings,
      });
    } catch (err) {
      llmError = err.message || String(err);
      if (err.code !== "MODEL_ALREADY_ACTIVE") {
        await runExclusiveLlmOperation(() => killLlm());
      }
      return json(res, jsonErrorStatus(err), {
        ok: false,
        error: llmError,
        code: err.code || "",
        activeRuntime: err.activeRuntime || null,
      });
    }
  }

  if (req.url === "/api/llm/stop" && req.method === "POST") {
    await runExclusiveLlmOperation(() => killLlm());
    return json(res, 200, { ok: true });
  }

  if (req.url === "/api/speech/status" && req.method === "GET") {
    const backend = getSpeechBackend();
    return json(res, 200, {
      ok: true,
      ready: speechReady,
      running: speechReady,
      port: PORT_SPEECH,
      preferredPort: PREFERRED_SPEECH_PORT,
      backendInstalled: Boolean(backend.cli),
      backendPath: backend.cli || "",
      serverPath: backend.server || "",
      backendMode: backend.mode,
      backendPreference: backend.preference,
      backends: backend.candidates,
      error: speechError,
      settings: speechSettings,
      transcription: speechTranscriptionState,
    });
  }

  if (req.url === "/api/speech/models" && req.method === "GET") {
    return json(res, 200, { ok: true, models: getSpeechModels() });
  }

  if (req.url === "/api/speech/start" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      await runExclusiveSpeechOperation(() => startSpeech(body));
      return json(res, 200, {
        ok: true,
        ready: speechReady,
        settings: speechSettings,
        port: PORT_SPEECH,
      });
    } catch (err) {
      speechError = err.message || String(err);
      return json(res, jsonErrorStatus(err), {
        ok: false,
        error: speechError,
        code: err.code || "",
        activeRuntime: err.activeRuntime || null,
      });
    }
  }

  if (req.url === "/api/speech/stop" && req.method === "POST") {
    await runExclusiveSpeechOperation(() => stopSpeech());
    return json(res, 200, { ok: true });
  }

  if (req.url.startsWith("/api/speech/transcribe") && req.method === "POST") {
    const parsed = new URL(
      req.url,
      `http://${req.headers.host || "localhost"}`,
    );
    try {
      const audio = await readBinaryBody(req);
      const result = await runExclusiveSpeechOperation(() =>
        transcribeWavBuffer(audio, {
          model: parsed.searchParams.get("model") || speechSettings.model,
          language: parsed.searchParams.get("language") || "auto",
          filename:
            parsed.searchParams.get("filename") ||
            req.headers["x-filename"] ||
            "recording.wav",
          threads: parsed.searchParams.get("threads") || speechSettings.threads,
          backendPreference:
            parsed.searchParams.get("backendPreference") ||
            speechSettings.backendPreference,
          translate: parsed.searchParams.get("translate") === "true",
          save: parsed.searchParams.get("save") !== "false",
        }),
      );
      return json(res, 200, { ok: true, transcription: result });
    } catch (err) {
      speechError = err.message || String(err);
      return json(res, /too large|troppo grande/i.test(err.message || "") ? 413 : 500, {
        ok: false,
        error: speechError,
      });
    }
  }

  if (req.url === "/api/speech/download-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    if (downloadState.active)
      return json(res, 409, {
        ok: false,
        error: "È già in corso lo scaricamento di un altro modello.",
      });
    const modelId = String(body.modelId || body.model_id || body.model || "");
    const catalogModel = SPEECH_MODEL_CATALOG.find(
      (model) => model.id === modelId || model.filename === modelId,
    );
    const url = body.url
      ? String(body.url)
      : catalogModel
        ? `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${catalogModel.filename}`
        : "";
    const filename = path.basename(
      String(body.filename || catalogModel?.filename || ""),
    );
    if (!url || !filename || !filename.toLowerCase().endsWith(".bin")) {
      return json(res, 400, {
        ok: false,
        error: "Occorre un indirizzo per un modello di trascrizione .bin o un identificativo del catalogo.",
      });
    }
    startModelDownload(url, filename, SPEECH_MODELS, "speech");
    return json(res, 200, {
      ok: true,
      message: "Scaricamento del modello di trascrizione avviato",
      filename,
    });
  }

  if (req.url.startsWith("/api/speech/import-model") && req.method === "POST") {
    try {
      const parsed = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`,
      );
      const result = await streamModelUpload(
        req,
        parsed.searchParams.get("filename"),
        SPEECH_MODELS,
        "speech",
      );
      return json(res, 200, {
        ok: true,
        message: `Importato ${result.filename}`,
        model: result,
      });
    } catch (err) {
      console.error("  [api] Failed to import speech model:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url === "/api/speech/delete-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    const modelPath = path.join(SPEECH_MODELS, filename);
    if (!filename || !pathInside(modelPath, SPEECH_MODELS)) {
      return json(res, 400, { ok: false, error: "Nome del file non valido" });
    }
    if (speechSettings.model === filename) await stopSpeech();
    try {
      fs.unlinkSync(modelPath);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, err.code === "ENOENT" ? 404 : 500, {
        ok: false,
        error: err.code === "ENOENT" ? "Modello di trascrizione non trovato" : err.message,
      });
    }
  }

  if (req.url === "/api/speech/transcriptions" && req.method === "GET") {
    return json(res, 200, { ok: true, transcriptions: listTranscriptions() });
  }

  if (req.url === "/api/speech/delete-transcription" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    if (!filename || !filename.endsWith(".json")) {
      return json(res, 400, { ok: false, error: "Nome del file non valido" });
    }
    const jsonPath = path.join(TRANSCRIPTIONS, filename);
    if (!pathInside(jsonPath, TRANSCRIPTIONS)) {
      return json(res, 400, { ok: false, error: "Percorso non valido" });
    }
    try {
      if (!fs.existsSync(jsonPath)) {
        return json(res, 404, {
          ok: false,
          error: "Dati della trascrizione non trovati",
        });
      }

      const metadata = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const textFile = metadata.textFile
        ? path.basename(String(metadata.textFile))
        : "";

      fs.unlinkSync(jsonPath);

      if (textFile) {
        const textPath = path.join(TRANSCRIPTIONS, textFile);
        if (pathInside(textPath, TRANSCRIPTIONS) && fs.existsSync(textPath)) {
          fs.unlinkSync(textPath);
        }
      }

      return json(res, 200, { ok: true });
    } catch (err) {
      console.error("  [api] Failed to delete transcription:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url === "/api/tts/status" && req.method === "GET") {
    const runtime = getTtsRuntimeStatus();
    return json(res, 200, {
      ok: true,
      ready: ttsReady,
      running: ttsReady,
      port: PORT_TTS,
      preferredPort: PREFERRED_TTS_PORT,
      runtimeInstalled: runtime.installed,
      runtimePath: runtime.runtime,
      workerPath: runtime.worker,
      cachePath: runtime.cache,
      backendMode: runtime.backendMode,
      error: ttsError,
      settings: ttsSettings,
      generation: ttsGenerationState,
      voices: TTS_VOICES,
    });
  }

  if (req.url === "/api/tts/models" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      models: getTtsModels(),
      voices: TTS_VOICES,
    });
  }

  if (req.url === "/api/tts/start" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      await runExclusiveTtsOperation(() => startTts(body));
      return json(res, 200, {
        ok: true,
        ready: ttsReady,
        settings: ttsSettings,
        port: PORT_TTS,
      });
    } catch (err) {
      ttsError = err.message || String(err);
      return json(res, jsonErrorStatus(err), {
        ok: false,
        error: ttsError,
        code: err.code || "",
        activeRuntime: err.activeRuntime || null,
      });
    }
  }

  if (req.url === "/api/tts/stop" && req.method === "POST") {
    await runExclusiveTtsOperation(() => stopTts());
    return json(res, 200, { ok: true });
  }

  if (req.url === "/api/tts/speak" && req.method === "POST") {
    const body = await readJsonBody(req, res, 512 * 1024);
    if (!body) return;
    try {
      if (!ttsReady || (body.model && ttsSettings.model !== body.model)) {
        await runExclusiveTtsOperation(() => startTts(body));
      }
      const output = await runExclusiveTtsOperation(() =>
        synthesizeTts(body.text, body),
      );
      return json(res, 200, { ok: true, output });
    } catch (err) {
      ttsError = err.message || String(err);
      return json(res, jsonErrorStatus(err), {
        ok: false,
        error: ttsError,
        code: err.code || "",
        activeRuntime: err.activeRuntime || null,
      });
    }
  }

  if (req.url === "/api/tts/download-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    try {
      const model = installTtsCatalogModel(
        body.modelId || body.model_id || body.model || body.filename,
      );
      return json(res, 200, {
        ok: true,
        message: "Configurazione del modello vocale installata",
        filename: model.filename,
        model,
      });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  if (req.url.startsWith("/api/tts/import-model") && req.method === "POST") {
    try {
      const parsed = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`,
      );
      const result = await streamModelUpload(
        req,
        parsed.searchParams.get("filename"),
        TTS_MODELS,
        "tts",
      );
      return json(res, 200, {
        ok: true,
        message: `Importato ${result.filename}`,
        model: result,
      });
    } catch (err) {
      console.error("  [api] Failed to import TTS model:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url === "/api/tts/delete-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    const modelPath = path.join(TTS_MODELS, filename);
    if (
      !filename ||
      !filename.endsWith(".json") ||
      !pathInside(modelPath, TTS_MODELS)
    ) {
      return json(res, 400, { ok: false, error: "Nome del file non valido" });
    }
    if (ttsSettings.model === filename) await stopTts();
    try {
      fs.unlinkSync(modelPath);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, err.code === "ENOENT" ? 404 : 500, {
        ok: false,
        error: err.code === "ENOENT" ? "Modello vocale non trovato" : err.message,
      });
    }
  }

  if (req.url === "/api/tts/outputs" && req.method === "GET") {
    return json(res, 200, { ok: true, outputs: listTtsOutputs() });
  }

  if (req.url === "/api/tts/delete-output" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    if (!filename || !filename.endsWith(".json")) {
      return json(res, 400, { ok: false, error: "Nome del file non valido" });
    }
    const jsonPath = path.join(TTS_OUTPUTS, filename);
    if (!pathInside(jsonPath, TTS_OUTPUTS)) {
      return json(res, 400, { ok: false, error: "Percorso non valido" });
    }
    try {
      if (!fs.existsSync(jsonPath)) {
        return json(res, 404, {
          ok: false,
          error: "Dati dell’audio vocale non trovati",
        });
      }
      const metadata = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const audioFile = metadata.audioFile
        ? path.basename(String(metadata.audioFile))
        : "";
      fs.unlinkSync(jsonPath);
      if (audioFile) {
        const audioPath = path.join(TTS_OUTPUTS, audioFile);
        if (pathInside(audioPath, TTS_OUTPUTS) && fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
        }
      }
      return json(res, 200, { ok: true });
    } catch (err) {
      console.error("  [api] Failed to delete TTS output:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  function isOomError(msg) {
    if (!msg) return false;
    const lower = String(msg).toLowerCase();
    return (
      lower.includes("out of memory") ||
      lower.includes("failed to allocate") ||
      lower.includes("failed to initialize the context") ||
      lower.includes("oom") ||
      lower.includes("not enough memory") ||
      lower.includes("allocation failed") ||
      lower.includes("failed to create context")
    );
  }

  async function retryLowerContext() {
    const currentCtx = llmSettings.contextSize || 4096;
    const contextLadder = [
      32768, 24576, 16384, 12288, 8192, 4096, 2048, 1024, 512,
    ];
    const nextLimit = contextLadder.find((limit) => limit < currentCtx);
    if (!nextLimit) {
      throw new Error("Non è possibile ridurre ulteriormente il contesto.");
    }
    console.log(
      `  [llm] Retrying with lower context limit: ${nextLimit} (was ${currentCtx})`,
    );

    const originalModel = llmSettings.model;
    const newSettings = {
      model: originalModel,
      threads: llmSettings.threads,
      contextSize: nextLimit,
      gpuLayers: llmSettings.gpuLayers,
      enableThinking: llmSettings.enableThinking,
    };

    await startLlm(newSettings);
  }

  // Asks the loaded model whether the latest message needs a web search and, if so, for a
  // standalone query that resolves references to earlier turns ("what about its price?").
  // Returns "" when the model decides no search is needed, or null if planning failed.

  async function doLlmChat(req, res, body, retryCount = 0) {
    try {
      const isStream = body.stream === true;
      const rawMessages = Array.isArray(body.messages) ? body.messages : [];
      const webAugmentation = { messages: rawMessages, webSources: [] };
      const requestData = JSON.stringify({
        model: llmSettings.model || "local-model",
        messages: webAugmentation.messages,
        temperature: Number.isFinite(Number(body.temperature))
          ? Number(body.temperature)
          : 0.7,
        max_tokens: Math.max(
          1,
          Math.min(
            512,
            Number(body.max_tokens) || Number(body.maxTokens) || 384,
          ),
        ),
        stream: isStream,
        // New sampling parameters
        top_p: Number.isFinite(Number(body.top_p)) ? Number(body.top_p) : 0.95,
        top_k: Number.isFinite(Number(body.top_k)) ? Number(body.top_k) : 40,
        min_p: Number.isFinite(Number(body.min_p)) ? Number(body.min_p) : 0.05,
        repeat_penalty: Number.isFinite(Number(body.repeat_penalty))
          ? Number(body.repeat_penalty)
          : 1.1,
        frequency_penalty: Number.isFinite(Number(body.frequency_penalty))
          ? Number(body.frequency_penalty)
          : 0.0,
        presence_penalty: Number.isFinite(Number(body.presence_penalty))
          ? Number(body.presence_penalty)
          : 0.0,
        seed: Number.isInteger(Number(body.seed))
          ? Number(body.seed)
          : undefined,
        stop: Array.isArray(body.stop)
          ? body.stop
          : body.stop
            ? [body.stop]
            : undefined,
      });

      if (isStream) {
        const clientReq = http.request(
          {
            hostname: "127.0.0.1",
            port: PORT_LLM,
            path: "/v1/chat/completions",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(requestData),
            },
            agent: llmHttpAgent, // ✅ HTTP keep-alive: eliminates TCP handshake per turn
          },
          (clientRes) => {
            if (clientRes.statusCode < 200 || clientRes.statusCode >= 300) {
              let errorBody = "";
              clientRes.setEncoding("utf8");
              clientRes.on("data", (chunk) => {
                errorBody += chunk;
              });
              clientRes.on("end", async () => {
                let message = `Text backend returned HTTP ${clientRes.statusCode}`;
                try {
                  message =
                    JSON.parse(errorBody || "{}").error?.message || message;
                } catch (_) {}

                if (isOomError(message) && retryCount === 0) {
                  try {
                    await retryLowerContext();
                    return doLlmChat(req, res, body, retryCount + 1);
                  } catch (retryErr) {
                    console.error("Failed OOM recovery retry:", retryErr);
                  }
                }
                json(res, clientRes.statusCode || 500, {
                  ok: false,
                  error: message,
                });
              });
              return;
            }
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
              "X-Content-Type-Options": "nosniff",
            });
            const socket = res.socket || res.connection;
            socket?.setNoDelay?.(true);
            res.flushHeaders?.();
            if (webAugmentation.webSources.length) {
              res.write(
                `event: web_sources\ndata: ${JSON.stringify({ sources: webAugmentation.webSources })}\n\n`,
              );
            }
            clientRes.on("data", (chunk) => res.write(chunk));
            clientRes.on("end", () => res.end());
            clientRes.on("error", (err) => res.destroy(err));
          },
        );

        clientReq.on("error", async (err) => {
          console.error("LLM stream request error:", err);
          if (isOomError(err.message) && retryCount === 0) {
            try {
              await retryLowerContext();
              return doLlmChat(req, res, body, retryCount + 1);
            } catch (retryErr) {
              console.error("Failed OOM recovery retry:", retryErr);
            }
          }
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: err.message }));
          } else {
            res.end();
          }
        });

        clientReq.write(requestData);
        clientReq.end();
        res.on("close", () => {
          if (!res.writableEnded && !clientReq.destroyed) clientReq.destroy();
        });
        return;
      } else {
        try {
          const result = await requestJson(
            `http://127.0.0.1:${PORT_LLM}/v1/chat/completions`,
            JSON.parse(requestData),
            300000,
          );
          if (webAugmentation.webSources.length) {
            result.web_sources = webAugmentation.webSources;
          }
          return json(res, 200, result);
        } catch (err) {
          if (isOomError(err.message) && retryCount === 0) {
            try {
              await retryLowerContext();
              return doLlmChat(req, res, body, retryCount + 1);
            } catch (retryErr) {
              console.error("Failed OOM recovery retry:", retryErr);
            }
          }
          throw err;
        }
      }
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message || String(err) });
    }
  }

  // ── llmfit Integration ──────────────────────────────────────────────────────────
  let cachedLlmfitResults = new Map();

  if (req.url === "/api/llm/chat" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    if (!llmReady)
      return json(res, 409, {
        ok: false,
        error: "Carica un modello di testo prima di inviare un messaggio.",
      });
    await runExclusiveLlmOperation(async () => {
      if (res.destroyed) return;
      if (!llmReady)
        return json(res, 409, {
          ok: false,
          error: "Carica un modello di testo.",
        });
      await new Promise((resolve) => {
        res.once("finish", resolve);
        res.once("close", resolve);
        void doLlmChat(req, res, body);
      });
    });
    return;
  }

  // GET /api/llm/recommend — llmfit recommendations

  // GET /api/hardware-specs
  if (req.url === "/api/hardware-specs" && req.method === "GET") {
    return json(res, 200, getHardwareSpecs());
  }

  // GET /api/backend-options

  // GET /api/telemetry
  if (req.url === "/api/telemetry" && req.method === "GET") {
    return json(res, 200, getTelemetry());
  }

  // GET /api/models — list available model files

  // POST /api/restart-backend — restart with new settings

  // POST /api/stop-backend

  // POST /api/download-backend

  // POST /api/download-model

  if (req.url === "/api/llm/download-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const url = String(body.url || "");
    if (!url) return json(res, 400, { ok: false, error: "Occorre specificare un indirizzo" });
    if (downloadState.active)
      return json(res, 409, {
        ok: false,
        error: "È già in corso lo scaricamento di un altro modello.",
      });
    try {
      const directUrl = url.includes("huggingface.co")
        ? url.replace("/blob/", "/resolve/")
        : url;
      const overrideFilename = body.filename
        ? path.basename(String(body.filename))
        : null;
      const filename =
        overrideFilename || path.basename(new URL(directUrl).pathname);
      if (!filename.toLowerCase().endsWith(".gguf")) {
        return json(res, 400, {
          ok: false,
          error: "L’indirizzo del modello di testo deve indicare un file .gguf.",
        });
      }
      startModelDownload(directUrl, filename, LLM_MODELS, "text");
      return json(res, 200, {
        ok: true,
        message: "Scaricamento del modello di testo avviato",
        filename,
      });
    } catch (err) {
      return json(res, 400, { ok: false, error: err.message || String(err) });
    }
  }

  // GET /api/download-progress
  if (req.url === "/api/download-progress" && req.method === "GET") {
    return json(res, 200, downloadState);
  }

  // POST /api/cancel-download
  if (req.url === "/api/cancel-download" && req.method === "POST") {
    const cancelled = cancelModelDownload();
    return json(res, 200, { ok: true, cancelled });
  }

  // GET /api/generation-progress

  // GET /api/outputs

  // GET /api/output-file?filename=...

  if (req.url.startsWith("/tts-outputs/") && req.method === "GET") {
    const filename = path.basename(
      decodeURIComponent(
        req.url.replace(/^\/tts-outputs\//, "").split("?")[0] || "",
      ),
    );
    const filePath = path.join(TTS_OUTPUTS, filename);
    if (
      !filename ||
      !pathInside(filePath, TTS_OUTPUTS) ||
      !fs.existsSync(filePath)
    ) {
      return json(res, 404, { ok: false, error: "Audio vocale non trovato" });
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".wav") ensureBrowserCompatibleTtsWav(filePath);
    const stat = fs.statSync(filePath);
    const contentType = MIME[ext] || "application/octet-stream";
    const range = req.headers.range;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
        });
        res.end();
        return;
      }

      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!match[1] && match[2]) {
        const suffixLength = Math.min(Number(match[2]) || 0, stat.size);
        start = stat.size - suffixLength;
        end = stat.size - 1;
      }

      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end >= stat.size ||
        start > end
      ) {
        res.writeHead(416, {
          "Content-Range": `bytes */${stat.size}`,
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
        });
        res.end();
        return;
      }

      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // POST /api/save-output

  // POST /api/delete-outputs

  // POST /api/import-model?filename=...

  if (req.url.startsWith("/api/llm/import-model") && req.method === "POST") {
    try {
      const parsed = new URL(
        req.url,
        `http://${req.headers.host || "localhost"}`,
      );
      const result = await streamModelUpload(
        req,
        parsed.searchParams.get("filename"),
        LLM_MODELS,
        "text",
      );
      return json(res, 200, {
        ok: true,
        message: `Importato ${result.filename}`,
        model: result,
      });
    } catch (err) {
      console.error("  [api] Failed to import text model:", err);
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  if (req.url === "/api/llm/delete-model" && req.method === "POST") {
    const body = await readJsonBody(req, res);
    if (!body) return;
    const filename = path.basename(String(body.filename || ""));
    const modelPath = path.join(LLM_MODELS, filename);
    if (!filename || !pathInside(modelPath, LLM_MODELS)) {
      return json(res, 400, { ok: false, error: "Nome del file non valido" });
    }
    if (llmSettings.model === filename && llmProc) await killLlm();
    try {
      fs.unlinkSync(modelPath);
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, err.code === "ENOENT" ? 404 : 500, {
        ok: false,
        error: err.code === "ENOENT" ? "Modello di testo non trovato" : err.message,
      });
    }
  }

  // POST /api/move-model { filename, from, to }: refile a model under the right type (a text GGUF
  // sitting with the image models). Moving a linked model moves only the link.

  // POST /api/pick-model-file { type }: open the system's own file dialog and return the chosen path.
  // The page can't learn a file's real location from a browser picker, but this server runs on the same machine.

  // POST /api/link-model { path, type }: use a model file where it already is, without copying it

  // POST /api/delete-model

  if (
    req.url.startsWith("/api/") ||
    req.url.startsWith("/sdapi/") ||
    req.url.startsWith("/v1/")
  ) {
    return json(res, 404, { ok: false, error: "Unknown API endpoint" });
  }

  // ── Static frontend files ─────────────────────────────────────────────────
  let filePath = path.join(DIST, req.url === "/" ? "index.html" : req.url);
  filePath = filePath.split("?")[0];
  if (!pathInside(filePath, DIST))
    return json(res, 403, { ok: false, error: "Percorso non valido" });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, "index.html");
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(data);
  });
});

server.timeout = 0; // Disable socket timeout for large model uploads/downloads

// Local-only by default: the UI has no login. Set UAIS_HOST=0.0.0.0 to share it on your network.
server.listen(PORT_FRONTEND, process.env.UAIS_HOST || "127.0.0.1", () => {
  console.log("");
  console.log("  ============================================================");
  console.log("   LOCAL STUDIO · SCUOLA      |  Running");
  console.log("   Server Build: " + SERVER_BUILD);
  console.log("   Frontend : http://localhost:" + PORT_FRONTEND);
  console.log("   Text API : starts on http://127.0.0.1:" + PREFERRED_LLM_PORT);
  console.log("   Speech   : managed locally, API on frontend port");
  console.log(
    "   TTS      : Kokoro ONNX managed locally, API on frontend port",
  );
  console.log("  ============================================================");
  console.log("");

  // Do not auto-start backend; wait for selection from the Web UI
  console.log(
    "  [backend] Ready. Waiting for model load request from the webapp...",
  );
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await killLlm();
  await stopSpeech();
  await stopTts();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await killLlm();
  await stopSpeech();
  await stopTts();
  process.exit(0);
});
