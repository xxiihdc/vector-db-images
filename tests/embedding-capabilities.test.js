import test from "node:test";
import assert from "node:assert/strict";
import { probeOpenClipCapabilities } from "../src/embedding/providers/open-clip/capabilities.js";
import { runEmbeddingCapabilitiesCommand } from "../src/cli/commands/embedding-capabilities.js";
import { buildCapabilityLines } from "../src/embedding/providers/open-clip/remediation.js";
import { DEFAULT_CONFIG } from "../src/config/defaults/config.js";
import { applyOpenClipCandidateToConfig } from "../src/embedding/providers/open-clip/model-candidates.js";

test("capability probe forwards candidate dependency and resolution hints", () => {
  let capturedCommand = null;
  let capturedPayload = null;
  const config = applyOpenClipCandidateToConfig(structuredClone(DEFAULT_CONFIG), {
    preset: "high-end",
    provider: "open-clip",
    model: "ViT-gopt-16-SigLIP2-384",
    pretrained: "webli",
    target_resolution: 384,
    requires_timm: true,
    requires_transformers: true,
  });

  const payload = probeOpenClipCapabilities({
    config,
    bridgeRunner: (command, input) => {
      capturedCommand = command;
      capturedPayload = input;
      return {
        ok: false,
        provider: input.provider,
        model: input.model,
        pretrained: input.pretrained,
        model_identity: `${input.provider}:${input.model}:${input.pretrained}`,
        candidate: {
          candidate_preset: input.candidate_preset,
          candidate_id: input.candidate_id,
          recommended_extractor_size: input.target_resolution,
          target_resolution: input.target_resolution,
          requires_timm: input.requires_timm,
          requires_transformers: input.requires_transformers,
        },
        capabilities: {
          runtime_device: "mps",
          load_ok: false,
          recommended_extractor_size: input.target_resolution,
        },
        requirements: [
          {
            kind: "python-library",
            name: "transformers",
            status: "missing",
            install_command: "python3 -m pip install transformers",
            message: "Install transformers.",
          },
        ],
      };
    },
  });

  assert.equal(capturedCommand, "capabilities");
  assert.equal(capturedPayload.target_resolution, 384);
  assert.equal(capturedPayload.requires_timm, true);
  assert.equal(capturedPayload.requires_transformers, true);
  assert.equal(payload.candidate.recommended_extractor_size, 384);
});

test("embedding capabilities command surfaces warnings and remediation lines", async () => {
  const payload = await runEmbeddingCapabilitiesCommand({
    cwd: "/tmp/mvi",
    loadConfigFn: async () => ({
      config: structuredClone(DEFAULT_CONFIG),
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    probeOpenClipCapabilitiesFn: () => ({
      ok: false,
      provider: "open-clip",
      model: "ViT-gopt-16-SigLIP2-384",
      pretrained: "webli",
      candidate: {
        candidate_preset: "high-end",
        candidate_id: "open-clip:ViT-gopt-16-SigLIP2-384:webli:384",
        target_resolution: 384,
        recommended_extractor_size: 384,
        requires_timm: true,
        requires_transformers: true,
      },
      capabilities: {
        torch_available: true,
        open_clip_available: true,
        pillow_available: true,
        runtime_device: "mps",
        load_ok: false,
        load_error: "No module named 'transformers'",
        downloads_model_on_first_run: true,
        recommended_extractor_size: 384,
      },
      requirements: [
        {
          kind: "python-library",
          name: "transformers",
          status: "missing",
          install_command: "python3 -m pip install transformers",
          message: "Install transformers.",
        },
      ],
    }),
  });

  assert.equal(Array.isArray(payload.warnings), true);
  assert.equal(payload.warnings.some((warning) => warning.includes("transformers")), true);
  assert.equal(payload.lines.includes("Probe outcome: blocked"), true);
});

test("capability lines render load failures and high-resolution warnings", () => {
  const lines = buildCapabilityLines({
    ok: false,
    provider: "open-clip",
    model: "ViT-gopt-16-SigLIP2-384",
    pretrained: "webli",
    candidate: {
      candidate_preset: "high-end",
      candidate_id: "open-clip:ViT-gopt-16-SigLIP2-384:webli:384",
      target_resolution: 384,
      recommended_extractor_size: 384,
      requires_timm: true,
      requires_transformers: true,
    },
    capabilities: {
      torch_available: true,
      open_clip_available: true,
      pillow_available: true,
      runtime_device: "mps",
      load_ok: false,
      load_error: "No module named 'transformers'",
      downloads_model_on_first_run: true,
      recommended_extractor_size: 384,
    },
    requirements: [
      {
        kind: "python-library",
        name: "transformers",
        status: "missing",
        install_command: "python3 -m pip install transformers",
        message: "Install transformers.",
      },
    ],
  });

  assert.equal(lines.includes("Model load ok: no"), true);
  assert.equal(
    lines.some((line) => line.includes("higher-resolution extraction (384px)")),
    true
  );
  assert.equal(
    lines.some((line) => line.includes("No module named 'transformers'")),
    true
  );
});
