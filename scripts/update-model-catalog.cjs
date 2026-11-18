// Teacher maintenance command; the app itself uses the offline JSON snapshot.
const fs = require("node:fs");
const path = require("node:path");
const file = path.resolve(__dirname, "../config/models/chat.json");
const LIMIT = 4 * 1024 ** 3;
const quantization = (name) => name.match(/(?:^|[-.])(UD-)?(IQ\d[_A-Z0-9]*|Q\d[_A-Z0-9]*|BF16|F16|FP16)\.gguf$/i)?.slice(1).filter(Boolean).join("")?.toUpperCase();

async function main() {
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const model of catalog) {
    if (!model.repository) throw new Error(`Repository mancante: ${model.name}`);
    const response = await fetch(`https://huggingface.co/api/models/${model.repository}?blobs=true`, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`${model.repository}: HTTP ${response.status}`);
    const info = await response.json();
    const revision = info.sha;
    const asset = (entry, filename = path.basename(entry.rfilename)) => ({
      filename,
      sizeBytes: entry.size,
      approxSize: `${(entry.size / 1024 ** 3).toFixed(2)} GiB`,
      url: `https://huggingface.co/${model.repository}/resolve/${revision}/${entry.rfilename.split("/").map(encodeURIComponent).join("/")}`,
    });
    model.variants = info.siblings.filter((entry) =>
      entry.rfilename.endsWith(".gguf") && !entry.rfilename.includes("/") &&
      !/mmproj|mtp|imatrix/i.test(entry.rfilename) && quantization(entry.rfilename) &&
      Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= LIMIT,
    ).map((entry) => ({ quantization: quantization(entry.rfilename), ...asset(entry) }))
      .sort((a, b) => a.sizeBytes - b.sizeBytes);
    if (!model.variants.length) throw new Error(`Nessuna variante entro 4 GiB: ${model.name}`);
    if (model.projectorFile) {
      const entry = info.siblings.find((entry) => entry.rfilename === model.projectorFile);
      if (!entry || !Number.isSafeInteger(entry.size) || entry.size > LIMIT) throw new Error(`Proiettore assente o troppo grande: ${model.name}`);
      // Repositories often call their projector mmproj-F16.gguf: avoid collisions.
      model.projector = asset(entry, `${model.id}-mmproj-F16.gguf`);
    }
    model.sourceRevision = revision;
    model.verifiedAt = new Date().toISOString();
    console.log(`${model.name}: ${model.variants.length} versioni entro 4 GiB`);
  }
  // Write only after all repositories have been checked successfully.
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
