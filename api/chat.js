import { Groq } from "groq-sdk";

export const config = { maxDuration: 120 };

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* ═══════════════════════════════════════════
   RATE LIMITER
═══════════════════════════════════════════ */
const rateMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const window = 60000;
  const limit = 20;
  if (!rateMap.has(ip)) rateMap.set(ip, []);
  const arr = rateMap.get(ip).filter(t => now - t < window);
  if (arr.length >= limit) return false;
  arr.push(now);
  rateMap.set(ip, arr);
  return true;
}

/* ═══════════════════════════════════════════
   MEMORY STORE
═══════════════════════════════════════════ */
const memoryStore = new Map();

function getMemory(userId) {
  if (!memoryStore.has(userId)) {
    memoryStore.set(userId, {
      profile: { language: null },
      tasks: [],
      preferences: {},
      patterns: [],
    });
  }
  return memoryStore.get(userId);
}

function updateMemory(userId, update) {
  const mem = getMemory(userId);
  if (update.language) mem.profile.language = update.language;
  if (update.task) {
    mem.tasks.unshift(update.task);
    if (mem.tasks.length > 50) mem.tasks.pop();
  }
  if (update.pattern) mem.patterns.push(update.pattern);
}

/* ═══════════════════════════════════════════
   SAFE JSON RESPONSE
═══════════════════════════════════════════ */
function sendJSON(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

/* ═══════════════════════════════════════════
   SAFE JSON PARSER (CRITICAL FIX)
═══════════════════════════════════════════ */
function safeParseJSON(text, fallback) {
  try {
    if (!text) return fallback;

    const clean = text.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");

    if (start === -1 || end === -1) return fallback;

    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return fallback;
  }
}

/* ═══════════════════════════════════════════
   CORE AI CALL
═══════════════════════════════════════════ */
async function callAI(messages, maxTokens = 1200, temperature = 0.7) {
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: maxTokens,
      temperature,
    });

    return res?.choices?.[0]?.message?.content || "";
  } catch (e) {
    console.error("AI ERROR:", e.message);
    return "";
  }
}

/* ═══════════════════════════════════════════
   WEB SEARCH
═══════════════════════════════════════════ */
async function webSearch(query, depth = "basic") {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        search_depth: depth,
        max_results: 6,
        include_answer: true,
      }),
    });

    const data = await res.json();
    const answer = data.answer ? `Summary: ${data.answer}\n\n` : "";

    const results = data.results
      ?.map(r => `[${r.title}]\n${r.content}\nSource: ${r.url}`)
      .join("\n\n") || "No results.";

    return answer + results;
  } catch {
    return "Search failed.";
  }
}

/* ═══════════════════════════════════════════
   LANGUAGE DETECTOR
═══════════════════════════════════════════ */
async function detectLanguage(text) {
  const out = await callAI([
    {
      role: "system",
      content: "Detect language. Reply ONLY with language name.",
    },
    { role: "user", content: text.substring(0, 200) },
  ], 10, 0.1);

  return out.trim() || "English";
}

/* ═══════════════════════════════════════════
   COMPLEXITY ANALYZER
═══════════════════════════════════════════ */
async function analyzeComplexity(userMessage, memory) {
  const out = await callAI([
    {
      role: "system",
      content: `Return ONLY JSON:
{
  "level": "simple|medium|complex",
  "needsClarification": true|false,
  "clarificationQuestion": "",
  "domains": [],
  "estimatedSteps": 1,
  "taskTitle": ""
}`,
    },
    { role: "user", content: userMessage },
  ], 300, 0.1);

  return safeParseJSON(out, {
    level: "simple",
    needsClarification: false,
    domains: ["research"],
    estimatedSteps: 1,
    taskTitle: "Task",
  });
}

/* ═══════════════════════════════════════════
   TASK PLANNER
═══════════════════════════════════════════ */
async function planTask(userMessage, complexity, memory, language) {
  const out = await callAI([
    {
      role: "system",
      content: `Return ONLY JSON:
{
  "plan": [{ "step":1,"title":"","agent":"","action":"","tool":"none"}],
  "approach": ""
}`,
    },
    { role: "user", content: userMessage },
  ], 600, 0.3);

  return safeParseJSON(out, {
    plan: [{ step: 1, title: "Execute", agent: "researchCore", action: "Process", tool: "none" }],
    approach: "Direct",
  });
}

/* ═══════════════════════════════════════════
   SAFETY CHECK
═══════════════════════════════════════════ */
async function safetyCheck(message) {
  const out = await callAI([
    {
      role: "system",
      content: `Return JSON: { "safe": true|false }`,
    },
    { role: "user", content: message },
  ], 50, 0.1);

  return safeParseJSON(out, { safe: true });
}

/* ═══════════════════════════════════════════
   AGENTS (unchanged logic)
═══════════════════════════════════════════ */
async function researchCore(task, context, language) {
  const searchData = await webSearch(task, "advanced");

  return await callAI([
    { role: "system", content: `Respond in ${language}` },
    ...context,
    { role: "user", content: task + "\n\n" + searchData },
  ], 1500, 0.5);
}

async function codeCore(task, context, language) {
  return await callAI([
    { role: "system", content: `Respond in ${language}` },
    ...context,
    { role: "user", content: task },
  ], 2000, 0.4);
}

async function writeCore(task, context, language) {
  return await callAI([
    { role: "system", content: `Respond in ${language}` },
    ...context,
    { role: "user", content: task },
  ], 2000, 0.8);
}

async function legalCore(task, context, language) {
  return await callAI([
    { role: "system", content: `Respond in ${language}` },
    ...context,
    { role: "user", content: task },
  ], 1500, 0.3);
}

async function dataCore(task, context, language) {
  return await callAI([
    { role: "system", content: `Respond in ${language}` },
    ...context,
    { role: "user", content: task },
  ], 1500, 0.4);
}

async function stratCore(task, context, language) {
  return await callAI([
    { role: "system", content: `Respond in ${language}` },
    ...context,
    { role: "user", content: task },
  ], 1500, 0.6);
}

async function routeToAgent(agent, task, context, language) {
  switch (agent) {
    case "codeCore": return codeCore(task, context, language);
    case "writeCore": return writeCore(task, context, language);
    case "legalCore": return legalCore(task, context, language);
    case "dataCore": return dataCore(task, context, language);
    case "stratCore": return stratCore(task, context, language);
    default: return researchCore(task, context, language);
  }
}

/* ═══════════════════════════════════════════
   MAIN HANDLER
═══════════════════════════════════════════ */
export default async function handler(req, res) {
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";

  if (!rateLimit(ip)) {
    return sendJSON(res, 429, {
      status: "error",
      error: "Rate limit exceeded",
      reply: null,
    });
  }

  if (req.method !== "POST") {
    return sendJSON(res, 405, { status: "error", error: "Method not allowed" });
  }

  /* SAFE BODY PARSE (FIXED) */
  let body;
  try {
    if (!req.body) body = {};
    else if (typeof req.body === "object") body = req.body;
    else body = JSON.parse(req.body);
  } catch {
    return sendJSON(res, 400, { status: "error", error: "Invalid JSON body" });
  }

  const messages = body.messages || [];
  const userMessage = messages[messages.length - 1]?.content || "";

  if (!userMessage) {
    return sendJSON(res, 400, { status: "error", error: "Empty message" });
  }

  const memory = getMemory(ip);

  try {
    const safety = await safetyCheck(userMessage);
    if (!safety.safe) {
      return sendJSON(res, 200, {
        status: "blocked",
        reply: "Request blocked by safety layer.",
      });
    }

    const language = memory.profile.language || await detectLanguage(userMessage);
    updateMemory(ip, { language });

    const complexity = await analyzeComplexity(userMessage, memory);

    const agent =
      complexity.domains?.[0] === "coding" ? "codeCore" :
      complexity.domains?.[0] === "writing" ? "writeCore" :
      complexity.domains?.[0] === "legal" ? "legalCore" :
      complexity.domains?.[0] === "data" ? "dataCore" :
      complexity.domains?.[0] === "strategy" ? "stratCore" :
      "researchCore";

    const reply = await routeToAgent(agent, userMessage, messages.slice(0, -1), language);

    updateMemory(ip, {
      task: {
        title: complexity.taskTitle,
        level: complexity.level,
        timestamp: Date.now(),
      },
    });

    return sendJSON(res, 200, {
      status: "success",
      reply: reply && reply.trim() ? reply : "ArcCore failed to respond properly.",
      intent: agent,
      language,
    });

  } catch (err) {
    console.error("CRASH:", err.message);

    return sendJSON(res, 500, {
      status: "error",
      error: "Internal error",
      reply: "ArcCore crashed. Try again.",
    });
  }
}
