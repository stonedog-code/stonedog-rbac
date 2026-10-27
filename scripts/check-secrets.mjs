#!/usr/bin/env node
// Copyright (C) 2026 StoneDogCode L.L.C.
// SPDX-License-Identifier: Apache-2.0
/**
 * No credential enters this repository (PRD-0067 R-S2).
 *
 *   node scripts/check-secrets.mjs               # every git-tracked file
 *   node scripts/check-secrets.mjs --paths a b   # named files, for the tests
 *
 * A package that two products install onto their sign-in path must not be the
 * place a token leaks from. CI also runs gitleaks over the history (see
 * gate.yml); this is the layer that runs everywhere `npm run gate` runs,
 * offline, with no download — so the local gate and the hosted one agree on at
 * least the well-known shapes.
 *
 * Output is MASKED. A scanner that prints the secret it found has republished
 * it into a log.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SHAPES = [
  { name: "AWS access key id", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: "Stripe key", re: /\b(sk|rk|pk)_(live|test)_[0-9A-Za-z]{16,}\b|\bwhsec_[0-9A-Za-z]{16,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "private key block", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "connection string with a password", re: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis):\/\/[^:\s/]+:[^@\s]{4,}@/ },
  { name: "assigned secret literal", re: /\b(password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token)\b\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/i },
];

/** Lines that are allowed to look like a secret, and why. */
const ALLOWED = [
  // This file's own pattern table.
  /scripts\/check-secrets\.mjs$/,
];

function mask(value) {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 8)}${value.slice(-4)}`;
}

const args = process.argv.slice(2);
let files;
const pathsArg = args.indexOf("--paths");
if (pathsArg >= 0) {
  files = args.slice(pathsArg + 1);
} else {
  files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
}

const findings = [];
let examined = 0;
for (const file of files) {
  if (ALLOWED.some((re) => re.test(file))) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted or binary-unreadable
  }
  if (text.includes("\u0000")) continue; // binary
  examined += 1;
  text.split("\n").forEach((line, index) => {
    for (const { name, re } of SHAPES) {
      const m = re.exec(line);
      if (m) findings.push({ file, line: index + 1, name, masked: mask(m[0]) });
    }
  });
}

if (examined === 0) {
  console.error("check-secrets: examined 0 files — nothing was scanned, which is not the same as clean.");
  process.exit(1);
}
if (findings.length > 0) {
  console.error(`check-secrets: ${findings.length} credential-shaped value(s) in ${examined} file(s):`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.name}  ${f.masked}`);
  console.error("Rotate anything real before removing it: a secret that has been in a commit is compromised.");
  process.exit(1);
}
console.log(`check-secrets: examined ${examined} file(s); 0 credential-shaped values`);
