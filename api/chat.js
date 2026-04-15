import { Groq } from "groq-sdk";

export const config = {
  maxDuration: 60,
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* =========================
   🧠 MEMORY STORE (replace with DB in SaaS v3)
========================= */
const memoryStore = new Map();

/* =========================
   ⚡ RATE LIMIT (production safety)
========================= */
const rateLimitStore = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxReq = 12;

  if (!rateLimitStore.has(ip)) rateLimitStore.set(ip, []);

  const arr = rateLimitStore.get(ip).filter(t => now - t < windowMs);

  if (arr.length >= maxReq) return false;

  arr.push(now);
  rateLimitStore.set(ip, arr);
  return true;
}

/* =========================
   📦 SAFE RESPONSE
========================= */
function sendJSON(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

/* =========================
   🧠 MEMORY SYSTEM (STRUCTURED)
========================= */
function getMemory(userId) {
  if (!memoryStore.has(userId)) {
    memoryStore.set(userId, []);
  }
  return memoryStore.get(userId);
}

function addMemory(userId, role, content) {
  const mem = getMemory(userId);
  mem.push({ role, content, ts: Date.now() });

  if (mem.length > 25) mem.shift();
}

/* =========================
   ⏱ TIMEOUT WRAPPER
========================= */
function withTimeout(promise, ms = 25000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), ms)
    ),
  ]);
}

/* =========================
   🧠 SAFE AI ENGINE (RETRY + STABILITY)
========================= */
async function ai(messages, max_tokens = 800, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await withTimeout(
        groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages,
          max_tokens,
          temperature: 0.7,
        })
      );

      const out = res?.choices?.[0]?.message?.content;

      if (out && out.trim().length > 0) return out;
    } catch (err) {
      console.error("AI retry error:", err.message);
    }
  }

  return null;
}

/* =========================
   🌐 WEB SEARCH (TAVILY SAFE)
========================= */
async function webSearch(query) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: "basic",
        max_results: 5,
      }),
    });

    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return "Search service error.";
    }

    const results =
      data?.results?.map(r =>
        `Title: ${r.title}\n${r.content}\nURL: ${r.url}`
      ) || [];

    return results.join("\n\n") || "No results found.";
  } catch (e) {
    return "Search failed.";
  }
}

/* =========================
   🧭 INTENT ROUTER (CORE OF SAAS)
========================= */
function detectIntent(text) {
  const t = text.toLowerCase();

  const builder = /(build|create|make|website|web app|app|dashboard|portfolio)/;
  const search = /(latest|news|today|current|price|weather|update|who is|what is)/;

  if (builder.test(t)) return "BUILDER";
  if (search.test(t)) return "SEARCH";
  return "CHAT";
}

/* =========================
   🧠 CHAT AGENT
========================= */
async function chatAgent(messages) {
  return (
    (await ai(messages, 900)) ||
    "⚠️ I couldn't generate a response."
  );
}

/* =========================
   🌐 SEARCH AGENT
========================= */
async function searchAgent(query) {
  const data = await webSearch(query);

  const result = await ai(
    [
      {
        role: "system",
        content:
          "Use ONLY the provided real-time data. Be factual and concise.",
      },
      { role: "user", content: data },
    ],
    900
  );

  return result || "⚠️ Search failed.";
}

/* =========================
   🧱 BUILDER AGENT (STABLE PIPELINE)
========================= */
async function builderAgent(messages) {
  const plan = await ai(
    [
      ...messages,
      {
        role: "system",
        content:
          "Create a structured web app plan (pages, UI, features).",
      },
    ],
    500
  );

  const components = await ai(
    [
      { role: "system", content: "Generate React + Tailwind components." },
      { role: "user", content: plan || "" },
    ],
    900
  );

  const project = await ai(
    [
      { role: "system", content: "Generate full project structure." },
      { role: "user", content: components || "" },
    ],
    1000
  );

  return {
    reply: `
🚀 PLAN:
${plan || "Failed"}

🧩 COMPONENTS:
${components || "Failed"}

📦 PROJECT:
${project || "Failed"}
    `,
    preview: extractPreview(project),
  };
}

/* =========================
   🧾 PREVIEW EXTRACTOR
========================= */
function extractPreview(text) {
  if (!text) return null;

  const match = text.match(/```(?:html|jsx|tsx)?([\s\S]*?)```/i);
  if (match) return match[1];

  if (text.includes("<div") || text.includes("<html")) {
    return text;
  }

  return null;
}

/* =========================
   🚀 MAIN API HANDLER (SAAS V2 CORE)
========================= */
export default async function handler(req, res) {
  const ip =
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown";

  if (!rateLimit(ip)) {
    return sendJSON(res, 429, {
      error: "Rate limit exceeded",
    });
  }

  if (req.method !== "POST") {
    return sendJSON(res, 405, { error: "Method not allowed" });
  }

  let body;
  try {
    body =
      typeof req.body === "object"
        ? req.body
        : JSON.parse(req.body);
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON" });
  }

  const rawMessages = body.messages || [];
  const userId = body.userId || ip;

  const userMessage =
    rawMessages[rawMessages.length - 1]?.content || "";

  /* =========================
     🧠 MEMORY WRITE
  ========================= */
  addMemory(userId, "user", userMessage);

  const memory = getMemory(userId).slice(-10);

  const messages = [
    {
      role: "system",
      content:
        "You are Bimo AI — a production SaaS AI agent system.",
    },
    ...memory.map(m => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const intent = detectIntent(userMessage);

  try {
    let result;

    /* ================= CHAT ================= */
    if (intent === "CHAT") {
      result = {
        reply: await chatAgent(messages),
      };
    }

    /* ================= SEARCH ================= */
    if (intent === "SEARCH") {
      result = {
        reply: await searchAgent(userMessage),
      };
    }

    /* ================= BUILDER ================= */
    if (intent === "BUILDER") {
      result = await builderAgent(messages);
    }

    /* ================= FINAL RESPONSE ================= */
    return sendJSON(res, 200, {
      status: "success",
      reply: result?.reply || "⚠️ No response generated.",
      preview: result?.preview || null,
      intent,
    });
  } catch (err) {
    return sendJSON(res, 500, {
      status: "error",
      error: "SAAS v2 crash safe handler",
      details: err.message,
    });
  }
}
