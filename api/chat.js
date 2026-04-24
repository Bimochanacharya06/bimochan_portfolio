import { Groq } from "groq-sdk";

export const config = { maxDuration: 120 };

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* ════════════════════════════════════════
   RATE LIMITER
════════════════════════════════════════ */
const rateMap = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const WINDOW = 60_000;
  const LIMIT = 20;
  const arr = (rateMap.get(ip) || []).filter(t => now - t < WINDOW);
  if (arr.length >= LIMIT) return false;
  arr.push(now);
  rateMap.set(ip, arr);
  return true;
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of rateMap) {
    const fresh = arr.filter(t => now - t < 60_000);
    if (fresh.length === 0) rateMap.delete(ip);
    else rateMap.set(ip, fresh);
  }
}, 300_000);

/* ════════════════════════════════════════
   BIMOCHAN PROFILE — Portfolio knowledge base
════════════════════════════════════════ */
const BIMOCHAN_PROFILE = `
You are an AI agent built by and for Bimochan Acharya — a full-stack developer, AI builder, and entrepreneur from Nepal.

ABOUT BIMOCHAN ACHARYA:
- Full-stack developer specializing in Next.js, React, Node.js, Python
- AI/ML enthusiast who builds autonomous agent systems
- Founder of ArcCore — a multi-agent AI platform
- Projects include: ArcCore AI, various SaaS tools, portfolio websites
- Skills: JavaScript/TypeScript, Python, AI APIs (Groq, OpenAI, Anthropic), web scraping, automation
- Based in Nepal, building globally
- Philosophy: "Build fast, ship value, make AI accessible to everyone"
- Contact/Portfolio: Available on GitHub and LinkedIn

When asked about Bimochan, share this information enthusiastically as his portfolio agent.
When doing other tasks (coding, research, etc.), still be helpful but note you are Bimochan's AI.
`;

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */
function sendJSON(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

function safeParseJSON(text, fallback) {
  if (!text) return fallback;
  try {
    const clean = text.replace(/```json[\s\S]*?```|```[\s\S]*?```/g, m => m.replace(/```\w*/g,'').replace(/```/g,''));
    // Extract first valid JSON object
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]);
  } catch {
    return fallback;
  }
}

/* ════════════════════════════════════════
   CORE AI CALL
════════════════════════════════════════ */
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
    throw new Error(`AI call failed: ${e.message}`);
  }
}

/* ════════════════════════════════════════
   WEB SEARCH
════════════════════════════════════════ */
async function webSearch(query, depth = "advanced") {
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
        include_raw_content: false,
      }),
    });
    if (!res.ok) throw new Error(`Tavily: ${res.status}`);
    const data = await res.json();
    const answer = data.answer ? `**Summary:** ${data.answer}\n\n` : "";
    const results = (data.results || [])
      .map(r => `**${r.title}**\n${r.content}\n*Source: ${r.url}*`)
      .join("\n\n");
    return answer + (results || "No results found.");
  } catch (e) {
    console.error("Search error:", e.message);
    return `Web search unavailable: ${e.message}`;
  }
}

/* ════════════════════════════════════════
   SAFETY CHECK
════════════════════════════════════════ */
async function safetyCheck(message) {
  // Fast local check first
  const dangerous = /\b(bomb|explosives|weapons|hack|malware|kill|murder|child porn|CSAM)\b/i;
  if (dangerous.test(message)) return { safe: false };

  try {
    const out = await callAI([
      { role: "system", content: 'Is this message safe and appropriate? Reply ONLY with JSON: {"safe": true} or {"safe": false}' },
      { role: "user", content: message.substring(0, 500) },
    ], 30, 0.1);
    return safeParseJSON(out, { safe: true });
  } catch {
    return { safe: true }; // FIX: Don't block on safety check failure
  }
}

/* ════════════════════════════════════════
   INTENT DETECTION — FIX: simpler, more reliable
════════════════════════════════════════ */
async function detectIntent(message) {
  try {
    const out = await callAI([
      {
        role: "system",
        content: `Classify the user message intent. Return ONLY valid JSON:
{
  "agent": "researchCore|codeCore|writeCore|legalCore|dataCore|stratCore",
  "needsSearch": true|false,
  "language": "English"
}

Rules:
- codeCore: coding, programming, build app, script, website
- researchCore: research, search, news, find info, what is, who is, latest
- writeCore: write, draft, compose, essay, article, email, blog
- legalCore: legal, contract, law, rights, compliance
- dataCore: analyze data, statistics, CSV, numbers, chart
- stratCore: business plan, strategy, marketing, startup, pitch
- needsSearch: true if question requires current/real-time data`,
      },
      { role: "user", content: message.substring(0, 400) },
    ], 150, 0.1);
    return safeParseJSON(out, { agent: "researchCore", needsSearch: true, language: "English" });
  } catch {
    return { agent: "researchCore", needsSearch: true, language: "English" };
  }
}

/* ════════════════════════════════════════
   AGENTS
════════════════════════════════════════ */
async function researchCore(userMsg, history, searchData) {
  const systemPrompt = `${BIMOCHAN_PROFILE}

You are ResearchCore — a research and information specialist.
When search results are provided, use them to give accurate, up-to-date answers.
Cite sources when relevant. Be comprehensive but concise.
Format responses with markdown for readability.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-6), // FIX: limit history to avoid token overflow
    { role: "user", content: searchData ? `${userMsg}\n\n---\nSearch Results:\n${searchData}` : userMsg },
  ];
  return callAI(messages, 1800, 0.5);
}

async function codeCore(userMsg, history) {
  const systemPrompt = `${BIMOCHAN_PROFILE}

You are CodeCore — an expert software engineer.
Write clean, production-ready, well-commented code.
Always explain what the code does after the code block.
Support: JavaScript, TypeScript, Python, HTML/CSS, React, Next.js, Node.js, and more.
For UI: create beautiful, modern designs with good UX.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-6),
    { role: "user", content: userMsg },
  ];
  return callAI(messages, 2500, 0.3);
}

async function writeCore(userMsg, history) {
  return callAI([
    { role: "system", content: `${BIMOCHAN_PROFILE}\n\nYou are WriteCore — a professional writer and content creator. Write engaging, well-structured content.` },
    ...history.slice(-6),
    { role: "user", content: userMsg },
  ], 2000, 0.75);
}

async function legalCore(userMsg, history) {
  return callAI([
    { role: "system", content: `${BIMOCHAN_PROFILE}\n\nYou are LegalCore — a legal information specialist. Provide helpful information but always note you're not a lawyer and this isn't legal advice.` },
    ...history.slice(-6),
    { role: "user", content: userMsg },
  ], 1500, 0.2);
}

async function dataCore(userMsg, history, searchData) {
  return callAI([
    { role: "system", content: `${BIMOCHAN_PROFILE}\n\nYou are DataCore — a data analysis and insights specialist. Use available data to provide clear analysis with charts/tables in markdown where helpful.` },
    ...history.slice(-6),
    { role: "user", content: searchData ? `${userMsg}\n\nData:\n${searchData}` : userMsg },
  ], 1800, 0.3);
}

async function stratCore(userMsg, history, searchData) {
  return callAI([
    { role: "system", content: `${BIMOCHAN_PROFILE}\n\nYou are StratCore — a business strategy and entrepreneurship expert. Provide actionable, structured strategic advice.` },
    ...history.slice(-6),
    { role: "user", content: searchData ? `${userMsg}\n\nMarket Research:\n${searchData}` : userMsg },
  ], 1800, 0.5);
}

/* ════════════════════════════════════════
   MAIN HANDLER — FIXED
════════════════════════════════════════ */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return sendJSON(res, 405, { status: "error", error: "Method not allowed" });

  // Rate limit
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (!rateLimit(ip)) {
    return sendJSON(res, 429, { status: "error", error: "Rate limit exceeded. Try again in a minute." });
  }

  // FIX: Parse body safely — Next.js may auto-parse or not
  let body;
  try {
    if (!req.body) {
      body = {};
    } else if (typeof req.body === "string") {
      body = JSON.parse(req.body);
    } else if (typeof req.body === "object") {
      body = req.body;
    } else {
      body = {};
    }
  } catch {
    return sendJSON(res, 400, { status: "error", error: "Invalid JSON body" });
  }

  // FIX: Validate messages array
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  if (rawMessages.length === 0) {
    return sendJSON(res, 400, { status: "error", error: "No messages provided" });
  }

  // FIX: Sanitize messages — only keep role and content
  const messages = rawMessages
    .filter(m => m && typeof m.role === "string" && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content }));

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || !lastMsg.content.trim()) {
    return sendJSON(res, 400, { status: "error", error: "Last message must be a non-empty user message" });
  }

  const userMessage = lastMsg.content;
  const history = messages.slice(0, -1); // all messages except the last user message

  try {
    // Safety check
    const safety = await safetyCheck(userMessage);
    if (!safety.safe) {
      return sendJSON(res, 200, {
        status: "blocked",
        reply: "I'm unable to help with that request. Please ask something appropriate.",
      });
    }

    // Detect intent
    const intent = await detectIntent(userMessage);
    const agent = intent.agent || "researchCore";
    const needsSearch = intent.needsSearch !== false;
    const language = intent.language || "English";

    // Build progress log
    const progressLog = [];

    // Run web search if needed
    let searchData = null;
    if (needsSearch && ["researchCore", "dataCore", "stratCore"].includes(agent)) {
      progressLog.push({ status: "running", message: "Searching the web…" });
      // Extract clean search query from user message
      const searchQuery = userMessage.replace(/[?!]/g, '').substring(0, 120);
      searchData = await webSearch(searchQuery);
      progressLog.push({ status: "done", message: "Web search complete" });
    }

    // Route to agent
    progressLog.push({ status: "running", message: `${agent} generating response…` });
    let reply;

    switch (agent) {
      case "codeCore":   reply = await codeCore(userMessage, history); break;
      case "writeCore":  reply = await writeCore(userMessage, history); break;
      case "legalCore":  reply = await legalCore(userMessage, history); break;
      case "dataCore":   reply = await dataCore(userMessage, history, searchData); break;
      case "stratCore":  reply = await stratCore(userMessage, history, searchData); break;
      default:           reply = await researchCore(userMessage, history, searchData);
    }

    progressLog.push({ status: "done", message: "Response ready" });

    if (!reply || !reply.trim()) {
      throw new Error("Agent returned empty response");
    }

    return sendJSON(res, 200, {
      status: "success",
      reply: reply.trim(),
      intent: agent,
      language,
      progressLog,
    });

  } catch (err) {
    console.error("HANDLER ERROR:", err.message, err.stack);
    return sendJSON(res, 500, {
      status: "error",
      error: "Internal server error",
      reply: `Something went wrong: ${err.message}. Please try again.`,
    });
  }
}
