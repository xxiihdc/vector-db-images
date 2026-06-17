function normalizeRequirement(requirement = {}) {
  return {
    kind: requirement.kind ?? "environment",
    name: requirement.name ?? "Unknown requirement",
    status: requirement.status ?? "missing",
    install_command: requirement.install_command ?? null,
    message: requirement.message ?? null,
  };
}

export function buildCapabilityLines(payload = {}) {
  const requirements = Array.isArray(payload.requirements)
    ? payload.requirements.map(normalizeRequirement)
    : [];

  return [
    `Provider: ${payload.provider ?? "unknown"}`,
    `Model: ${payload.model ?? "unknown"}`,
    `Pretrained: ${payload.pretrained ?? "unknown"}`,
    `Platform: ${payload.platform ?? "unknown"}`,
    `Torch available: ${payload.capabilities?.torch_available ? "yes" : "no"}`,
    `OpenCLIP available: ${payload.capabilities?.open_clip_available ? "yes" : "no"}`,
    `Pillow available: ${payload.capabilities?.pillow_available ? "yes" : "no"}`,
    `Runtime device: ${payload.capabilities?.runtime_device ?? "unknown"}`,
    `First-run download required: ${payload.capabilities?.downloads_model_on_first_run ? "yes" : "no"}`,
    `Ready for local embedding: ${payload.ok ? "yes" : "no"}`,
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
