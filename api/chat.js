import { Groq } from "groq-sdk";

export const config = {
  maxDuration: 60,
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* =========================
   🧠 DATABASE LAYER (SUPABASE READY)
   Replace with real DB in production
========================= */
async function dbGetMessages(userId) {
  // TODO: Supabase SELECT
  return [];
}

async function dbSaveMessage(userId, message) {
  // TODO: Supabase INSERT
  return true;
}

/* =========================
   ⚡ RATE LIMIT (PRODUCTION SAFE)
========================= */
const rateMap = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const window = 60000;
  const limit = 15;

  if (!rateMap.has(ip)) rateMap.set(ip, []);

  const arr = rateMap
    .get(ip)
    .filter(t => now - t < window);

  if (arr.length >= limit) return false;

  arr.push(now);
  rateMap.set(ip, arr);

  return true;
}

/* =========================
   📡 STREAM ENGINE (CHATGPT STYLE)
========================= */
function streamResponse(res, text, speed = 12) {
  let i = 0;

  const interval = setInterval(() => {
    if (i >= text.length) {
      clearInterval(interval);
      res.end();
      return;
    }

    res.write(text[i]);
    i++;
  }, speed);
}

/* =========================
   🧠 SAFE AI ENGINE
========================= */
async function ai(messages, max_tokens = 900) {
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens,
      temperature: 0.7,
    });

    return res?.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error("AI error:", e.message);
    return null;
  }
}

/* =========================
   🌐 WEB SEARCH
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

    const data = JSON.parse(text);

    return (
      data.results
        ?.map(
          r =>
            `Title: ${r.title}\n${r.content}\nURL: ${r.url}`
        )
        .join("\n\n") || "No results"
    );
  } catch {
    return "Search failed";
  }
}

/* =========================
   🧭 INTENT ENGINE
========================= */
function detectIntent(text) {
  const t = text.toLowerCase();

  if (/(build|create|make|website|app|dashboard|portfolio)/.test(t))
    return "BUILDER";

  if (/(latest|news|price|weather|update|who is|current)/.test(t))
    return "SEARCH";

  return "CHAT";
}

/* =========================
   🧠 CHAT AGENT
========================= */
async function chatAgent(history) {
  return await ai(history, 900);
}

/* =========================
   🌐 SEARCH AGENT
========================= */
async function searchAgent(query) {
  const data = await webSearch(query);

  return await ai(
    [
      {
        role: "system",
        content: "Use ONLY provided real-time data.",
      },
      { role: "user", content: data },
    ],
    900
  );
}

/* =========================
   🧱 BUILDER AGENT (V4 SIMPLIFIED BUT STABLE)
========================= */
async function builderAgent(history) {
  const plan = await ai(history, 500);

  const code = await ai(
    [
      {
        role: "system",
        content:
          "Generate production React + Tailwind app code.",
      },
      { role: "user", content: plan || "" },
    ],
    1200
  );

  return {
    reply: code,
    preview: extractPreview(code),
  };
}

/* =========================
   🧾 PREVIEW EXTRACTOR
========================= */
function extractPreview(text) {
  if (!text) return null;

  const match = text.match(/```(?:html|jsx|tsx)?([\s\S]*?)```/i);
  if (match) return match[1];

  return text.includes("<div") ? text : null;
}

/* =========================
   🚀 MAIN HANDLER (V4 CORE)
========================= */
export default async function handler(req, res) {
  const ip =
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown";

  if (!rateLimit(ip)) {
    return res.status(429).json({
      error: "Rate limit exceeded",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  let body;
  try {
    body =
      typeof req.body === "object"
        ? req.body
        : JSON.parse(req.body);
  } catch {
    return res.status(400).json({
      error: "Invalid JSON",
    });
  }

  const { messages = [], userId = ip } = body;

  const userMessage =
    messages[messages.length - 1]?.content || "";

  /* =========================
     💾 SAVE USER MESSAGE
  ========================= */
  await dbSaveMessage(userId, {
    role: "user",
    content: userMessage,
  });

  const history = await dbGetMessages(userId);

  const intent = detectIntent(userMessage);

  let result;

  try {
    /* ================= CHAT ================= */
    if (intent === "CHAT") {
      result = await chatAgent(history);
    }

    /* ================= SEARCH ================= */
    if (intent === "SEARCH") {
      result = await searchAgent(userMessage);
    }

    /* ================= BUILDER ================= */
    if (intent === "BUILDER") {
      result = await builderAgent(history);
    }

    /* ================= STREAM RESPONSE ================= */
    res.setHeader("Content-Type", "text/plain");

    const final =
      typeof result === "string"
        ? result
        : result?.reply || "No response";

    streamResponse(res, final);
  } catch (err) {
    return res.status(500).json({
      error: "SAAS v4 crash",
      details: err.message,
    });
  }
}
