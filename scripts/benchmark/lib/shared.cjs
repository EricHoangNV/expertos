/**
 * Shared plumbing for the benchmark harness (env loading, dist imports, run ids,
 * a tiny concurrency pool, JSONL IO). Kept dependency-free so the harness runs
 * with plain `node` against the compiled workspace — no ts-node, no test runner.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BENCH_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(BENCH_DIR, "data");
const RESULTS_DIR = path.join(BENCH_DIR, "results");

/** Parse the repo `.env` into `process.env` (does not override already-set vars). */
function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** Import the compiled production modules the answer pipeline is built from. */
function requireDist() {
  const API = path.join(ROOT, "apps", "api", "dist");
  const db = require(path.join(ROOT, "packages", "db", "dist", "index.js"));
  const ai = require(path.join(ROOT, "packages", "ai", "dist", "index.js"));
  const { PgVectorStore } = require(path.join(API, "retrieval", "pgvector.store"));
  const defaults = require(path.join(API, "ingestion", "ingestion.defaults"));
  return { db, ai, PgVectorStore, defaults };
}

function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
  } catch {
    return "nogit";
  }
}

/** Compact local timestamp: YYYYMMDD-HHMMSS. */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function newRunId() {
  return `${stamp()}-${gitSha()}`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Minimal flag parser: --key value, --key=value, and --flag (boolean true). */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const body = a.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      out[body] = argv[++i];
    } else {
      out[body] = true;
    }
  }
  return out;
}

/** Run `fn` over `items` with at most `concurrency` in flight, preserving order of completion writes. */
async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** Append one record as a JSON line (atomic-ish per line; safe for concurrent single-process appends). */
function appendJsonl(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
}

/** Load a question set: `set` is the file prefix under data/ (default "dataset"). */
function loadDataset(lang, set = "dataset") {
  return readJson(path.join(DATA_DIR, `${set}.${lang}.json`));
}

module.exports = {
  ROOT,
  BENCH_DIR,
  DATA_DIR,
  RESULTS_DIR,
  loadEnv,
  requireDist,
  gitSha,
  stamp,
  newRunId,
  sha256,
  parseArgs,
  pool,
  readJson,
  readJsonl,
  appendJsonl,
  loadDataset,
};
