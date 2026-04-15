import { Groq } from "groq-sdk";

export const config = {
  maxDuration: 60,
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* =========================
   RATE LIMIT
========================= */
const rateMap = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const window = 60000;
  const limit = 15;

  if (!rateMap.has(ip)) rateMap.set(ip, []);

  const arr = rateMap.get(ip).filter(t => now - t < window);

  if (arr.length >= limit) return false;

  arr.push(now);
  rateMap.set(ip, arr);

  return true;
}

/* =========================
   SAFE JSON RESPONSE (IMPORTANT)
========================= */
function sendJSON(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

/* =========================
   SAFE AI CALL
========================= */
async function ai(messages, max_tokens = 900) {
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens,
      temperature: 0.7,
    });

    return res?.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("AI ERROR:", e.message);
    return null;
  }
}

/* =========================
   WEB SEARCH
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
      return "Search error.";
    }

    return (
      data.results
        ?.map(
          r =>
            `Title: ${r.title}\n${r.content}\nURL: ${r.url}`
        )
        .join("\n\n") || "No results found."
    );
  } catch {
    return "Search failed.";
  }
}

/* =========================
   INTENT DETECTION
========================= */
function detectIntent(text) {
  const t = text.toLowerCase();

  if (/(build|create|make|website|app|dashboard)/.test(t))
    return "BUILDER";

  if (/(latest|news|price|weather|update|who is|current)/.test(t))
    return "SEARCH";

  return "CHAT";
}

/* =========================
   CHAT AGENT
========================= */
async function chatAgent(messages) {
  const out = await ai(messages, 900);
  return out ?? "I couldn't generate a response.";
}

/* =========================
   SEARCH AGENT
========================= */
async function searchAgent(query) {
  const data = await webSearch(query);

  const out = await ai(
    [
      {
        role: "system",
        content: "Use ONLY provided data.",
      },
      { role: "user", content: data },
    ],
    900
  );

  return out ?? "Search failed.";
}

/* =========================
   BUILDER AGENT
========================= */
async function builderAgent(messages) {
  const plan = await ai(messages, 500);

  const code = await ai(
    [
      {
        role: "system",
        content:
          "Generate React + Tailwind production-ready UI.",
      },
      { role: "user", content: plan || "" },
    ],
    1200
  );

  return {
    reply: code ?? "Builder failed to generate code.",
    preview: extractPreview(code),
  };
}

/* =========================
   PREVIEW EXTRACTOR
========================= */
function extractPreview(text) {
  if (!text) return null;

  const match = text.match(/```(?:html|jsx|tsx)?([\s\S]*?)```/i);
  return match ? match[1] : null;
}

/* =========================
   MAIN HANDLER (FIXED — ALWAYS JSON)
========================= */
export default async function handler(req, res) {
  const ip =
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown";

  if (!rateLimit(ip)) {
    return sendJSON(res, 429, {
      status: "error",
      error: "Rate limit exceeded",
      reply: null,
    });
  }

  if (req.method !== "POST") {
    return sendJSON(res, 405, {
      status: "error",
      error: "Method not allowed",
      reply: null,
    });
  }

  let body;

  try {
    body =
      typeof req.body === "object"
        ? req.body
        : JSON.parse(req.body);
  } catch {
    return sendJSON(res, 400, {
      status: "error",
      error: "Invalid JSON body",
      reply: null,
    });
  }

  const { messages = [] } = body;

  const userMessage =
    messages[messages.length - 1]?.content || "";

  if (!userMessage) {
    return sendJSON(res, 400, {
      status: "error",
      error: "Empty message",
      reply: null,
    });
  }

  const intent = detectIntent(userMessage);

  try {
    let result = null;

    if (intent === "CHAT") {
      result = await chatAgent(messages);
    }

    if (intent === "SEARCH") {
      result = await searchAgent(userMessage);
    }

    if (intent === "BUILDER") {
      result = await builderAgent(messages);
    }

    /* =========================
       FINAL GUARANTEED SAFE RESPONSE
    ========================= */
    return sendJSON(res, 200, {
      status: "success",
      intent,
      reply:
        typeof result === "string"
          ? result
          : result?.reply ?? "No response generated",
      preview:
        typeof result === "object"
          ? result?.preview ?? null
          : null,
    });
  } catch (err) {
    return sendJSON(res, 500, {
      status: "error",
      error: "Server crashed safely",
      reply: "Something went wrong. Try again.",
      details: err.message,
    });
  }
}
