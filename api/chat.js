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
   MEMORY STORE (in-memory, replace with DB)
   Structure: { userId -> { profile, tasks, preferences } }
═══════════════════════════════════════════ */
const memoryStore = new Map();

function getMemory(userId) {
  if (!memoryStore.has(userId)) {
    memoryStore.set(userId, {
      profile: { language: null, preferredTone: null, expertise: null },
      tasks: [],        // past completed tasks
      preferences: {},  // learned preferences
      patterns: [],     // behavioral patterns learned
    });
  }
  return memoryStore.get(userId);
}

function updateMemory(userId, update) {
  const mem = getMemory(userId);
  if (update.language) mem.profile.language = update.language;
  if (update.task) {
    mem.tasks.unshift(update.task);
    if (mem.tasks.length > 50) mem.tasks.pop(); // keep last 50 tasks
  }
  if (update.pattern) mem.patterns.push(update.pattern);
  memoryStore.set(userId, mem);
}

/* ═══════════════════════════════════════════
   SAFE JSON RESPONSE
═══════════════════════════════════════════ */
function sendJSON(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

/* ═══════════════════════════════════════════
   CORE AI CALL — ALL AGENTS USE THIS
═══════════════════════════════════════════ */
async function callAI(messages, maxTokens = 1200, temperature = 0.7) {
  try {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: maxTokens,
      temperature,
    });
    return res?.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.error("AI ERROR:", e.message);
    return null;
  }
}

/* ═══════════════════════════════════════════
   WEB SEARCH — ResearchCore tool
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
      content: "Detect the language of the user's message. Reply with ONLY the language name in English. Example: 'Nepali', 'Spanish', 'English', 'French'. Nothing else.",
    },
    { role: "user", content: text.substring(0, 200) },
  ], 10, 0.1);
  return out?.trim() || "English";
}

/* ═══════════════════════════════════════════
   COMPLEXITY ANALYZER
   Returns: { level: "simple"|"medium"|"complex", needsClarification: bool, domains: [] }
═══════════════════════════════════════════ */
async function analyzeComplexity(userMessage, memory) {
  const memContext = memory.tasks.length > 0
    ? `User has completed ${memory.tasks.length} past tasks. Recent: ${memory.tasks.slice(0, 3).map(t => t.title).join(", ")}`
    : "New user, no history.";

  const out = await callAI([
    {
      role: "system",
      content: `You are ArcCore's task analyzer. Analyze the user's request and return ONLY valid JSON.

Complexity levels:
- "simple": Single question, factual, short answer, one domain
- "medium": Multi-step task, needs planning, one or two domains  
- "complex": Multi-domain, long-running, requires multiple tools, research + execution

Domains: coding, research, writing, legal, data, strategy

Return JSON:
{
  "level": "simple|medium|complex",
  "needsClarification": true|false,
  "clarificationQuestion": "only if needsClarification is true",
  "domains": ["array of relevant domains"],
  "estimatedSteps": 1-10,
  "taskTitle": "short title for this task"
}`,
    },
    { role: "user", content: `Memory: ${memContext}\n\nUser request: ${userMessage}` },
  ], 300, 0.1);

  try {
    const clean = out?.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { level: "simple", needsClarification: false, domains: ["research"], estimatedSteps: 1, taskTitle: "Task" };
  }
}

/* ═══════════════════════════════════════════
   TASK PLANNER — builds execution steps
═══════════════════════════════════════════ */
async function planTask(userMessage, complexity, memory, language) {
  const out = await callAI([
    {
      role: "system",
      content: `You are ArcCore's strategic planner. Create a precise execution plan.
Return ONLY valid JSON:
{
  "plan": [
    {
      "step": 1,
      "title": "Step title",
      "agent": "codeCore|researchCore|writeCore|legalCore|dataCore|stratCore",
      "action": "what exactly this step does",
      "tool": "search|execute|analyze|write|none"
    }
  ],
  "approach": "brief explanation of overall strategy"
}
Keep steps focused and efficient. Max 7 steps.`,
    },
    {
      role: "user",
      content: `Task: ${userMessage}\nComplexity: ${complexity.level}\nDomains: ${complexity.domains.join(", ")}\nLanguage: ${language}`,
    },
  ], 600, 0.3);

  try {
    const clean = out?.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return {
      plan: [{ step: 1, title: "Execute task", agent: "researchCore", action: "Process and respond", tool: "none" }],
      approach: "Direct execution",
    };
  }
}

/* ═══════════════════════════════════════════
   SAFETY CHECKER
═══════════════════════════════════════════ */
async function safetyCheck(message) {
  const out = await callAI([
    {
      role: "system",
      content: `You are ArcCore's safety layer. Check if the request is harmful, illegal, or unethical.
Reply ONLY with JSON: { "safe": true|false, "reason": "only if unsafe" }
Safe = legal, ethical, not promoting harm. Unsafe = illegal activities, violence, fraud, abuse, weapons of mass destruction.`,
    },
    { role: "user", content: message.substring(0, 500) },
  ], 80, 0.1);

  try {
    const clean = out?.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {
    return { safe: true };
  }
}

/* ═══════════════════════════════════════════
   ░░ THE 6 SPECIALIST AGENTS ░░
═══════════════════════════════════════════ */

// 1. CODECORE — Coding & Development
async function codeCore(task, context, language) {
  return await callAI([
    {
      role: "system",
      content: `You are CodeCore, ArcCore's elite software engineer. You write production-ready, clean, well-commented code.
- Always explain what the code does before showing it
- Use best practices and modern patterns
- If debugging, identify the exact issue clearly
- Support all major languages and frameworks
- Respond in ${language}`,
    },
    ...context,
    { role: "user", content: task },
  ], 2000, 0.4);
}

// 2. RESEARCHCORE — Web Research & News
async function researchCore(task, context, language) {
  const searchData = await webSearch(task, "advanced");
  return await callAI([
    {
      role: "system",
      content: `You are ResearchCore, ArcCore's master researcher. You synthesize information from multiple sources into clear, accurate, well-structured insights.
- Always cite sources
- Distinguish facts from opinions
- Highlight what's most important
- Be thorough but concise
- Respond in ${language}`,
    },
    ...context,
    {
      role: "user",
      content: `Research task: ${task}\n\nSearch results:\n${searchData}\n\nProvide a comprehensive, well-structured research report.`,
    },
  ], 1800, 0.5);
}

// 3. WRITECORE — Writing & Content
async function writeCore(task, context, language) {
  return await callAI([
    {
      role: "system",
      content: `You are WriteCore, ArcCore's master writer. You produce exceptional written content — articles, essays, emails, scripts, stories, marketing copy, academic writing.
- Match tone perfectly to the requested format
- Be creative, engaging, and precise
- Structure content for maximum impact
- Adapt style to the audience
- Respond in ${language}`,
    },
    ...context,
    { role: "user", content: task },
  ], 2000, 0.8);
}

// 4. LEGALCORE — Legal & Contracts
async function legalCore(task, context, language) {
  return await callAI([
    {
      role: "system",
      content: `You are LegalCore, ArcCore's expert legal advisor. You provide clear, accurate legal information and draft legal documents.
- Always clarify this is informational, not formal legal advice
- Explain legal concepts in plain language
- Draft contracts, clauses, and agreements precisely
- Identify risks and important considerations
- Reference relevant legal principles
- Respond in ${language}`,
    },
    ...context,
    { role: "user", content: task },
  ], 2000, 0.3);
}

// 5. DATACORE — Data Analysis
async function dataCore(task, context, language) {
  return await callAI([
    {
      role: "system",
      content: `You are DataCore, ArcCore's data scientist. You analyze data, identify patterns, create visualizations, and deliver actionable insights.
- Break down complex data problems clearly
- Provide statistical analysis when relevant
- Suggest visualizations and charts
- Write data processing code when needed (Python/JS)
- Turn numbers into clear narratives
- Respond in ${language}`,
    },
    ...context,
    { role: "user", content: task },
  ], 2000, 0.4);
}

// 6. STRATCORE — Business Strategy
async function stratCore(task, context, language) {
  return await callAI([
    {
      role: "system",
      content: `You are StratCore, ArcCore's elite business strategist. You think like a McKinsey consultant, a seasoned entrepreneur, and a visionary leader combined.
- Provide frameworks and structured thinking
- Give actionable, specific recommendations
- Consider market dynamics, competition, risks
- Think short-term execution AND long-term vision
- Be direct — no fluff, just insight
- Respond in ${language}`,
    },
    ...context,
    { role: "user", content: task },
  ], 2000, 0.6);
}

/* ═══════════════════════════════════════════
   AGENT ROUTER — picks the right specialist
═══════════════════════════════════════════ */
async function routeToAgent(agentName, task, context, language) {
  switch (agentName) {
    case "codeCore": return await codeCore(task, context, language);
    case "researchCore": return await researchCore(task, context, language);
    case "writeCore": return await writeCore(task, context, language);
    case "legalCore": return await legalCore(task, context, language);
    case "dataCore": return await dataCore(task, context, language);
    case "stratCore": return await stratCore(task, context, language);
    default: return await researchCore(task, context, language);
  }
}

/* ═══════════════════════════════════════════
   SYNTHESIZER — merges multi-agent outputs
═══════════════════════════════════════════ */
async function synthesize(originalTask, agentOutputs, language) {
  const combined = agentOutputs
    .map((o, i) => `[${o.agent} - Step ${i + 1}]\n${o.output}`)
    .join("\n\n---\n\n");

  return await callAI([
    {
      role: "system",
      content: `You are ArcCore's master synthesizer. Multiple specialist agents have completed parts of a task. Combine their outputs into one seamless, cohesive, brilliant final response.
- Remove redundancy
- Ensure logical flow
- Highlight the most important insights
- Make it feel like one unified intelligence produced it
- Respond in ${language}`,
    },
    {
      role: "user",
      content: `Original task: ${originalTask}\n\nAgent outputs:\n${combined}\n\nSynthesize into one perfect response.`,
    },
  ], 2500, 0.5);
}

/* ═══════════════════════════════════════════
   MAIN ARCCORE HANDLER
═══════════════════════════════════════════ */
export default async function handler(req, res) {
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  const userId = req.headers["x-user-id"] || ip; // use IP as userId for now

  if (!rateLimit(ip)) {
    return sendJSON(res, 429, {
      status: "error",
      error: "Rate limit exceeded. Please wait a moment.",
      reply: null,
    });
  }

  if (req.method !== "POST") {
    return sendJSON(res, 405, { status: "error", error: "Method not allowed", reply: null });
  }

  let body;
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body);
  } catch {
    return sendJSON(res, 400, { status: "error", error: "Invalid JSON body", reply: null });
  }

  const { messages = [], action = "chat" } = body;
  const userMessage = messages[messages.length - 1]?.content || "";

  if (!userMessage) {
    return sendJSON(res, 400, { status: "error", error: "Empty message", reply: null });
  }

  // Load user memory
  const memory = getMemory(userId);

  try {

    /* ── STEP 1: SAFETY CHECK ── */
    const safety = await safetyCheck(userMessage);
    if (!safety.safe) {
      return sendJSON(res, 200, {
        status: "blocked",
        reply: `⚠️ ArcCore cannot help with this request. ${safety.reason || "This falls outside ethical boundaries."}`,
        progressLog: [],
        intent: "blocked",
      });
    }

    /* ── STEP 2: DETECT LANGUAGE ── */
    const language = memory.profile.language || await detectLanguage(userMessage);
    updateMemory(userId, { language });

    /* ── STEP 3: ANALYZE COMPLEXITY ── */
    const complexity = await analyzeComplexity(userMessage, memory);

    /* ── STEP 4: NEEDS CLARIFICATION? ── */
    if (complexity.needsClarification && messages.length <= 2) {
      return sendJSON(res, 200, {
        status: "clarification_needed",
        reply: complexity.clarificationQuestion,
        progressLog: [{ step: 0, status: "question", message: "ArcCore needs one clarification before starting." }],
        intent: "clarify",
        complexity,
      });
    }

    /* ── STEP 5: SIMPLE TASK — DIRECT ANSWER ── */
    if (complexity.level === "simple") {
      const progressLog = [
        { step: 1, status: "done", message: `${complexity.domains[0] || "ArcCore"} processing your request…` },
      ];

      const agentName = complexity.domains[0] === "coding" ? "codeCore"
        : complexity.domains[0] === "legal" ? "legalCore"
        : complexity.domains[0] === "writing" ? "writeCore"
        : complexity.domains[0] === "data" ? "dataCore"
        : complexity.domains[0] === "strategy" ? "stratCore"
        : "researchCore";

      const reply = await routeToAgent(agentName, userMessage, messages.slice(0, -1), language);

      updateMemory(userId, {
        task: { title: complexity.taskTitle, domain: complexity.domains[0], timestamp: Date.now(), level: "simple" }
      });

      return sendJSON(res, 200, {
        status: "success",
        reply: reply || "ArcCore could not generate a response. Please try again.",
        progressLog,
        intent: agentName,
        complexity,
        language,
      });
    }

    /* ── STEP 6: MEDIUM/COMPLEX — PLAN + EXECUTE ── */
    const progressLog = [];

    // Build plan
    progressLog.push({ step: 0, status: "planning", message: "🧠 ArcCore is analyzing your task and building an execution plan…" });
    const taskPlan = await planTask(userMessage, complexity, memory, language);
    progressLog.push({ step: 0, status: "planned", message: `📋 Plan ready — ${taskPlan.plan.length} steps. Strategy: ${taskPlan.approach}` });

    // Execute each step
    const agentOutputs = [];
    const context = messages.slice(0, -1);

    for (const step of taskPlan.plan) {
      progressLog.push({
        step: step.step,
        status: "running",
        message: `⚡ Step ${step.step}: ${step.title} [${step.agent}]`,
      });

      let output;

      if (step.tool === "search") {
        // Search first, then process
        const searchResults = await webSearch(userMessage);
        output = await routeToAgent(step.agent, `${userMessage}\n\nSearch data:\n${searchResults}`, context, language);
      } else {
        output = await routeToAgent(step.agent, userMessage, context, language);
      }

      agentOutputs.push({ agent: step.agent, step: step.step, output: output || "" });
      progressLog.push({
        step: step.step,
        status: "done",
        message: `✅ Step ${step.step} complete: ${step.title}`,
      });
    }

    /* ── STEP 7: SYNTHESIZE if multi-agent ── */
    let finalReply;
    if (agentOutputs.length === 1) {
      finalReply = agentOutputs[0].output;
    } else {
      progressLog.push({ step: 99, status: "synthesizing", message: "🔗 Synthesizing all results into one unified response…" });
      finalReply = await synthesize(userMessage, agentOutputs, language);
      progressLog.push({ step: 99, status: "done", message: "✨ ArcCore has completed your task." });
    }

    // Save to memory
    updateMemory(userId, {
      task: {
        title: complexity.taskTitle,
        domains: complexity.domains,
        timestamp: Date.now(),
        level: complexity.level,
        steps: taskPlan.plan.length,
      }
    });

    return sendJSON(res, 200, {
      status: "success",
      reply: finalReply || "ArcCore completed the task but encountered an issue generating the final response.",
      progressLog,
      intent: complexity.domains.join("+"),
      complexity,
      taskPlan,
      language,
      memory: {
        totalTasksCompleted: memory.tasks.length,
        language: memory.profile.language,
      },
    });

  } catch (err) {
    console.error("ARCCORE CRASH:", err.message);
    return sendJSON(res, 500, {
      status: "error",
      error: "ArcCore encountered an unexpected error.",
      reply: "Something went wrong in ArcCore's processing pipeline. Please try again.",
      details: err.message,
    });
  }
}
