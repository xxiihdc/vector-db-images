#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    plan: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--plan") {
      args.plan = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      args.json = true;
    }
  }

  if (!args.plan) {
    throw new Error("Missing required `--plan <path>` argument.");
  }

  return args;
}

function runRg(pattern, cwd) {
  const result = spawnSync(
    "rg",
    [
      "-n",
      "--no-heading",
      "--color",
      "never",
      "--glob",
      "!node_modules",
      "--glob",
      "!.git",
      "--glob",
      "!specs/**",
      "--glob",
      "!.agents/**",
      pattern,
      ".",
    ],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `rg failed with status ${result.status}`);
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function toRepoRelativePaths(planText) {
  const matches = planText.match(/\b(?:src|python|scripts|tests|docs|specs)\/[A-Za-z0-9._/\-]+/g) ?? [];
  return unique(matches.filter((repoPath) => !repoPath.startsWith("specs/")));
}

function toBacktickedTokens(planText) {
  const matches = [...planText.matchAll(/`([^`\n]{2,80})`/g)].map((match) => match[1].trim());
  return unique(
    matches.filter((token) =>
      /[A-Za-z]/.test(token) &&
      token !== "AGENTS.md" &&
      !token.startsWith("./") &&
      !token.startsWith("/") &&
      !token.includes(" ") &&
      !token.startsWith("[") &&
      !token.endsWith("]")
    )
  );
}

function toKeywordPhrases(planText) {
  const lines = planText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(\d+\.|-)\s+/.test(line))
    .map((line) => line.replace(/^(\d+\.|-)\s+/, "").trim());

  const phrases = [];
  for (const line of lines) {
    if (line.length < 12) {
      continue;
    }

    const normalized = line
      .replace(/[`*:_()[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (normalized.length >= 12 && normalized.length <= 120) {
      phrases.push(normalized);
    }
  }

  return unique(phrases).slice(0, 40);
}

function classifyEvidence(evidence) {
  const implemented = [];
  const partial = [];
  const missing = [];

  for (const item of evidence) {
    if (item.kind === "path") {
      if (item.exists) {
        implemented.push(item);
      } else {
        missing.push(item);
      }
      continue;
    }

    if (item.matches.length >= 2) {
      implemented.push(item);
      continue;
    }

    if (item.matches.length === 1) {
      partial.push(item);
      continue;
    }

    missing.push(item);
  }

  return { implemented, partial, missing };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const planPath = path.resolve(repoRoot, args.plan);

  if (!fs.existsSync(planPath)) {
    throw new Error(`Plan file not found: ${planPath}`);
  }

  const planText = fs.readFileSync(planPath, "utf8");
  const pathEvidence = toRepoRelativePaths(planText).map((repoPath) => ({
    kind: "path",
    target: repoPath,
    exists: fs.existsSync(path.resolve(repoRoot, repoPath)),
    matches: [],
  }));

  const tokenEvidence = toBacktickedTokens(planText)
    .filter((token) => !token.includes(":") || token.includes("/"))
    .map((token) => ({
      kind: "token",
      target: token,
      matches: runRg(token, repoRoot),
    }));

  const phraseEvidence = toKeywordPhrases(planText)
    .map((phrase) => {
      const shortPattern = phrase
        .split(" ")
        .filter((part) => part.length >= 4)
        .slice(0, 6)
        .join("|");

      return {
        kind: "phrase",
        target: phrase,
        matches: shortPattern ? runRg(shortPattern, repoRoot) : [],
      };
    })
    .filter((item) => item.target.length >= 12);

  const evidence = [...pathEvidence, ...tokenEvidence, ...phraseEvidence];
  const grouped = classifyEvidence(evidence);

  const payload = {
    plan_path: path.relative(repoRoot, planPath),
    implemented_count: grouped.implemented.length,
    partial_count: grouped.partial.length,
    missing_count: grouped.missing.length,
    implemented: grouped.implemented,
    partial: grouped.partial,
    missing: grouped.missing,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const lines = [
    `Plan: ${payload.plan_path}`,
    `Implemented signals: ${payload.implemented_count}`,
    `Partial signals: ${payload.partial_count}`,
    `Missing signals: ${payload.missing_count}`,
    "",
    "Implemented:",
    ...grouped.implemented.slice(0, 20).map((item) => `- [${item.kind}] ${item.target}`),
    "",
    "Partial:",
    ...grouped.partial.slice(0, 20).map((item) => `- [${item.kind}] ${item.target}`),
    "",
    "Missing:",
    ...grouped.missing.slice(0, 20).map((item) => `- [${item.kind}] ${item.target}`),
    "",
    "Top matches:",
  ];

  for (const item of [...grouped.implemented, ...grouped.partial].slice(0, 12)) {
    if (item.matches.length === 0) {
      continue;
    }

    lines.push(`- ${item.target}`);
    for (const match of item.matches.slice(0, 2)) {
      lines.push(`  ${match}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
