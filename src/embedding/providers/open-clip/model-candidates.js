const DEFAULT_PROVIDER = "open-clip";
const DEFAULT_BASELINE_MODEL = "ViT-B-32";
const DEFAULT_BASELINE_PRETRAINED = "laion2b_s34b_b79k";

export const DEFAULT_OPEN_CLIP_CANDIDATE_PRESET = "baseline";
export const DEFAULT_BENCHMARK_ASSET_LIMIT = 50;
export const DEFAULT_BENCHMARK_QUERY_LIMIT = 5;

export const OPEN_CLIP_MODEL_CANDIDATES = Object.freeze([
  {
    id: "open-clip:ViT-B-32:laion2b_s34b_b79k:224",
    preset: "baseline",
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_BASELINE_MODEL,
    pretrained: DEFAULT_BASELINE_PRETRAINED,
    target_resolution: 224,
    batch_size: 8,
    benchmark_batch_size: 8,
    tier: "baseline",
    requires_timm: false,
    requires_transformers: false,
  },
  {
    id: "open-clip:PE-Core-bigG-14-448:metaclip_fullcc:448",
    preset: "stretch",
    provider: DEFAULT_PROVIDER,
    model: "PE-Core-bigG-14-448",
    pretrained: "metaclip_fullcc",
    target_resolution: 448,
    batch_size: 1,
    benchmark_batch_size: 1,
    tier: "stretch",
    requires_timm: true,
    requires_transformers: false,
  },
  {
    id: "open-clip:ViT-gopt-16-SigLIP2-384:webli:384",
    preset: "high-end",
    provider: DEFAULT_PROVIDER,
    model: "ViT-gopt-16-SigLIP2-384",
    pretrained: "webli",
    target_resolution: 384,
    batch_size: 1,
    benchmark_batch_size: 1,
    tier: "high-end",
    requires_timm: true,
    requires_transformers: true,
  },
  {
    id: "open-clip:ViT-H-14-378-quickgelu:dfn5b:378",
    preset: "fallback-strong",
    provider: DEFAULT_PROVIDER,
    model: "ViT-H-14-378-quickgelu",
    pretrained: "dfn5b",
    target_resolution: 378,
    batch_size: 2,
    benchmark_batch_size: 2,
    tier: "fallback",
    requires_timm: true,
    requires_transformers: false,
  },
  {
    id: "open-clip:ViT-H-14:laion2b_s32b_b79k:224",
    preset: "fallback-safe",
    provider: DEFAULT_PROVIDER,
    model: "ViT-H-14",
    pretrained: "laion2b_s32b_b79k",
    target_resolution: 224,
    batch_size: 2,
    benchmark_batch_size: 2,
    tier: "fallback",
    requires_timm: true,
    requires_transformers: false,
  },
]);

export function listOpenClipBenchmarkCandidates() {
  return OPEN_CLIP_MODEL_CANDIDATES.filter((candidate) => candidate.preset !== "baseline");
}

export function getOpenClipCandidateByPreset(preset) {
  if (!preset) {
    return null;
  }

  return (
    OPEN_CLIP_MODEL_CANDIDATES.find((candidate) => candidate.preset === String(preset).trim()) ?? null
  );
}

export function getOpenClipCandidateById(candidateId) {
  if (!candidateId) {
    return null;
  }

  return (
    OPEN_CLIP_MODEL_CANDIDATES.find((candidate) => candidate.id === String(candidateId).trim()) ?? null
  );
}

export function buildOpenClipModelIdentity({
  provider = DEFAULT_PROVIDER,
  model = DEFAULT_BASELINE_MODEL,
  pretrained = DEFAULT_BASELINE_PRETRAINED,
} = {}) {
  return [provider, model, pretrained].join(":");
}

export function resolveOpenClipCandidate(config = {}) {
  const configuredPreset =
    config?.embedding?.candidate_preset ?? DEFAULT_OPEN_CLIP_CANDIDATE_PRESET;
  const presetCandidate = getOpenClipCandidateByPreset(configuredPreset);
  const explicitProvider = config?.embedding?.provider ?? presetCandidate?.provider ?? DEFAULT_PROVIDER;
  const explicitModel = config?.embedding?.model ?? presetCandidate?.model ?? DEFAULT_BASELINE_MODEL;
  const explicitPretrained =
    config?.embedding?.pretrained ?? presetCandidate?.pretrained ?? DEFAULT_BASELINE_PRETRAINED;

  const exactCandidate =
    OPEN_CLIP_MODEL_CANDIDATES.find(
      (candidate) =>
        candidate.provider === explicitProvider &&
        candidate.model === explicitModel &&
        candidate.pretrained === explicitPretrained
    ) ?? null;
  const selectedCandidate = exactCandidate ?? presetCandidate;
  const targetResolution =
    config?.embedding?.target_resolution ??
    selectedCandidate?.target_resolution ??
    config?.extractor?.image_thumbnail_size ??
    224;
  const batchSize =
    config?.embedding?.batch_size ??
    selectedCandidate?.batch_size ??
    8;
  const benchmarkBatchSize =
    config?.embedding?.benchmark_batch_size ??
    selectedCandidate?.benchmark_batch_size ??
    batchSize;
  const modelIdentity = buildOpenClipModelIdentity({
    provider: explicitProvider,
    model: explicitModel,
    pretrained: explicitPretrained,
  });

  return {
    candidate_id:
      selectedCandidate?.id ??
      `${modelIdentity}:${targetResolution}`,
    candidate_preset: selectedCandidate?.preset ?? configuredPreset ?? null,
    provider: explicitProvider,
    model: explicitModel,
    pretrained: explicitPretrained,
    target_resolution: targetResolution,
    batch_size: batchSize,
    benchmark_batch_size: benchmarkBatchSize,
    tier: selectedCandidate?.tier ?? "custom",
    requires_timm: selectedCandidate?.requires_timm ?? false,
    requires_transformers: selectedCandidate?.requires_transformers ?? false,
    model_identity: modelIdentity,
  };
}

export function applyOpenClipCandidateToConfig(config = {}, candidate = {}) {
  const nextConfig = structuredClone(config);
  nextConfig.extractor = {
    ...(nextConfig.extractor ?? {}),
    image_thumbnail_size:
      candidate.target_resolution ??
      nextConfig.extractor?.image_thumbnail_size ??
      224,
  };
  nextConfig.embedding = {
    ...(nextConfig.embedding ?? {}),
    provider: candidate.provider ?? nextConfig.embedding?.provider ?? DEFAULT_PROVIDER,
    model: candidate.model ?? nextConfig.embedding?.model ?? DEFAULT_BASELINE_MODEL,
    pretrained:
      candidate.pretrained ??
      nextConfig.embedding?.pretrained ??
      DEFAULT_BASELINE_PRETRAINED,
    candidate_preset:
      candidate.candidate_preset ??
      candidate.preset ??
      nextConfig.embedding?.candidate_preset ??
      DEFAULT_OPEN_CLIP_CANDIDATE_PRESET,
    target_resolution:
      candidate.target_resolution ??
      nextConfig.embedding?.target_resolution ??
      nextConfig.extractor?.image_thumbnail_size ??
      224,
    batch_size:
      candidate.batch_size ??
      nextConfig.embedding?.batch_size ??
      8,
    benchmark_batch_size:
      candidate.benchmark_batch_size ??
      nextConfig.embedding?.benchmark_batch_size ??
      candidate.batch_size ??
      nextConfig.embedding?.batch_size ??
      8,
  };

  return nextConfig;
}
