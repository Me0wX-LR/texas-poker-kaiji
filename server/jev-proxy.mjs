import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export const JEV_PORT = 47921;
const UPSTREAM = "https://api.typesafe.ai/v1/systemone";
const ALLOWED = new Set(["action", "size"]);
const recent = [];

export function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function tableKey() {
  const value = process.env.TYPESAFE_API_KEY || "";
  if (!value || value.length > 400 || /[\r\n]/.test(value)) return "";
  return value;
}

function allow() {
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= 40) return false;
  recent.push(now);
  return true;
}

function send(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function keepQuestions(input) {
  if (!input || typeof input !== "object") return null;
  const questions = {};
  for (const name of Object.keys(input)) {
    if (!ALLOWED.has(name)) continue;
    const question = input[name];
    if (!question || question.type !== "choice" || typeof question.instructions !== "string") return null;
    if (!question.criteria || typeof question.criteria !== "object") return null;
    questions[name] = {
      type: "choice",
      instructions: question.instructions.slice(0, 600),
      criteria: question.criteria,
    };
  }
  if (!questions.action) return null;
  return questions;
}

async function forward(state, questions) {
  const secret = tableKey();
  if (!secret) return { status: 503, body: { error: "off" } };
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ state, model: "jev-latest", questions }),
    signal: AbortSignal.timeout(15000),
  });
  if (!upstream.ok) return { status: 502, body: { error: "off" } };
  const data = await upstream.json();
  const answers = data && typeof data === "object" ? data.answers : null;
  return { status: 200, body: { answers: answers && typeof answers === "object" ? answers : {} } };
}

export function startJevProxy() {
  loadLocalEnv();
  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    if (req.method === "GET" && (url === "/api/jev" || url === "/api/jev/")) {
      send(res, 200, { ready: Boolean(tableKey()) });
      return;
    }
    if (req.method !== "POST" || (url !== "/api/jev" && url !== "/api/jev/")) {
      send(res, 404, { error: "off" });
      return;
    }
    if (!allow()) {
      send(res, 429, { error: "off" });
      return;
    }
    const chunks = [];
    let size = 0;
    let tooBig = false;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 48000) {
        tooBig = true;
        break;
      }
      chunks.push(chunk);
    }
    if (tooBig) {
      send(res, 413, { error: "off" });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      send(res, 400, { error: "off" });
      return;
    }
    const questions = keepQuestions(parsed?.questions);
    if (!parsed || typeof parsed.state !== "object" || !questions) {
      send(res, 400, { error: "off" });
      return;
    }
    try {
      const result = await forward(parsed.state, questions);
      send(res, result.status, result.body);
    } catch {
      send(res, 502, { error: "off" });
    }
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const server = startJevProxy();
  server.listen(JEV_PORT, "127.0.0.1", () => {
    console.log(`Jev proxy on 127.0.0.1:${JEV_PORT} (key loaded: ${tableKey() ? "yes" : "no"})`);
  });
}
