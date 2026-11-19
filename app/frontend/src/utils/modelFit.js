const GIB = 1024 ** 3;

// Conservative planning envelope, not measured RSS or a throughput benchmark.
// Includes room for the context/KV cache, compute buffers and runtime overhead.
export function estimateModelFit(variant, model, specs, telemetry, vision = false) {
  const weights = Number(variant?.sizeBytes) / GIB;
  const total = Number(telemetry?.ram_total_gb);
  const used = Number(telemetry?.ram_used_gb);
  if (!(weights > 0) || !(total > 0) || !Number.isFinite(used) || used < 0)
    return { known: false };
  const available = Math.max(0, total - used);
  const projector = vision ? Number(model?.projector?.sizeBytes) / GIB : 0;
  if (vision && !(projector > 0)) return { known: false };
  const low = weights * 1.05 + 0.65 + (vision ? projector * 1.1 + 0.5 : 0);
  const high = weights * 1.25 + 1.75 + (vision ? projector * 1.4 + 1.5 : 0);
  const budget = Math.max(0, available - 0.5);
  const level = high <= budget ? "comfortable" : low <= budget ? "tight" : "insufficient";
  const threads = Math.max(1, Math.min(4, Number(specs?.cpu_cores_physical) || 1));
  const load = vision || weights > 2.5 || threads <= 2 ? "elevato" : weights > 1.2 ? "medio" : "contenuto";
  return { known: true, low, high, available, budget, threads, level, load };
}
