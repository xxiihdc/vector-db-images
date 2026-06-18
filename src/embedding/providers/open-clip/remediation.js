function normalizeRequirement(requirement = {}) {
  return {
    kind: requirement.kind ?? "environment",
    name: requirement.name ?? "Unknown requirement",
    status: requirement.status ?? "missing",
    install_command: requirement.install_command ?? null,
    message: requirement.message ?? null,
  };
}

export function buildCapabilityWarnings(payload = {}) {
  const warnings = [];
  const candidate = payload.candidate ?? {};
  const capabilities = payload.capabilities ?? {};

  if (candidate.requires_timm) {
    warnings.push("Candidate expects `timm` support before fair probing.");
  }

  if (candidate.requires_transformers) {
    warnings.push("Candidate expects `transformers` support before fair probing.");
  }

  if (Number(candidate.target_resolution ?? 0) > 224) {
    warnings.push(
      `Candidate expects higher-resolution extraction (${candidate.target_resolution}px) for fair benchmark results.`
    );
  }

  if (capabilities.load_ok === false && capabilities.load_error) {
    warnings.push(`Model load failed during capability probe: ${capabilities.load_error}`);
  }

  return warnings;
}

export function buildCapabilityLines(payload = {}) {
  const requirements = Array.isArray(payload.requirements)
    ? payload.requirements.map(normalizeRequirement)
    : [];
  const warnings = buildCapabilityWarnings(payload);

  return [
    `Provider: ${payload.provider ?? "unknown"}`,
    `Model: ${payload.model ?? "unknown"}`,
    `Pretrained: ${payload.pretrained ?? "unknown"}`,
    `Candidate preset: ${payload.candidate?.candidate_preset ?? "custom"}`,
    `Candidate id: ${payload.candidate?.candidate_id ?? payload.model_identity ?? "unknown"}`,
    `Platform: ${payload.platform ?? "unknown"}`,
    `Torch available: ${payload.capabilities?.torch_available ? "yes" : "no"}`,
    `OpenCLIP available: ${payload.capabilities?.open_clip_available ? "yes" : "no"}`,
    `Pillow available: ${payload.capabilities?.pillow_available ? "yes" : "no"}`,
    `Runtime device: ${payload.capabilities?.runtime_device ?? "unknown"}`,
    `Model load ok: ${payload.capabilities?.load_ok ? "yes" : "no"}`,
    `Recommended extractor size: ${payload.capabilities?.recommended_extractor_size ?? payload.candidate?.recommended_extractor_size ?? "unknown"}`,
    `First-run download required: ${payload.capabilities?.downloads_model_on_first_run ? "yes" : "no"}`,
    `Ready for local embedding: ${payload.ok ? "yes" : "no"}`,
    ...warnings.map((warning, index) => `Warning ${index + 1}: ${warning}`),
    ...requirements.map((requirement, index) => {
      const installHint = requirement.install_command
        ? ` | Install: ${requirement.install_command}`
        : "";
      const message = requirement.message ? ` | ${requirement.message}` : "";
      return `Requirement ${index + 1}: ${requirement.name} [${requirement.kind}]${installHint}${message}`;
    }),
  ];
}

export function normalizeCapabilityRequirements(payload = {}) {
  return Array.isArray(payload.requirements)
    ? payload.requirements.map(normalizeRequirement)
    : [];
}
