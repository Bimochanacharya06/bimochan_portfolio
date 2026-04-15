import { Groq } from "groq-sdk";

export const config = { maxDuration: 60 };

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* ------------------ UTIL ------------------ */
function sendJSON(res, status, payload) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(payload);
}

function truncate(text, max = 2000) {
  return text?.length > max ? text.slice(0, max) + "\n...[truncated]" : text;
}

/* ------------------ PROMPT ------------------ */
const masterPrompt = `
You are Bimo AI — assistant for Bimochan Acharya and a senior developer.

Be:
- precise, honest, useful
- avoid hallucinations
- structured in output

BUILDER MODE:
- React + Tailwind only
- modular components
- clean structure
`;

/* ------------------ BUILDER STEPS ------------------ */

async function generatePlan(messages) {
  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      ...messages,
      { role: "system", content: "Return ONLY a short project plan." },
    ],
    max_tokens: 500,
  });
  return truncate(res.choices[0].message.content, 1500);
}

async function generateComponents(plan) {
  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "Generate key React components only (Navbar, Hero, Footer).",
      },
      { role: "user", content: plan },
    ],
    max_tokens: 1000,
  });
  return truncate(res.choices[0].message.content, 3000);
}

async function assembleProject(components) {
  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "Return minimal project structure only (no long code).",
      },
      { role: "user", content: components },
    ],
    max_tokens: 800,
  });
  return truncate(res.choices[0].message.content, 2000);
}

/* ------------------ HANDLER ------------------ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return sendJSON(res, 405, { error: "Method not allowed" });

  let body;
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body);
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON" });
  }

  try {
    const rawMessages = body.messages || [];
    const apiMessages = rawMessages.slice(-5);

    if (!apiMessages.some((m) => m.role === "system")) {
      apiMessages.unshift({ role: "system", content: masterPrompt });
    }

    const userMessage =
      rawMessages[rawMessages.length - 1]?.content || "";

    const isBuilder =
      /build|create|website|portfolio|landing/i.test(userMessage);

    /* -------- BUILDER MODE -------- */
    if (isBuilder) {
      try {
        const plan = await generatePlan(apiMessages);
        const components = await generateComponents(plan);
        const project = await assembleProject(components);

        return sendJSON(res, 200, {
          type: "builder",
          data: {
            plan,
            components,
            project,
          },
        });
      } catch (err) {
        return sendJSON(res, 200, {
          type: "builder_error",
          error: "Builder failed safely",
        });
      }
    }

    /* -------- NORMAL CHAT -------- */
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: apiMessages,
      max_tokens: 1000,
    });

    return sendJSON(res, 200, {
      type: "chat",
      reply: response.choices[0].message.content,
    });
  } catch (error) {
    return sendJSON(res, 500, {
      error: "Server error",
      details: error.message,
    });
  }
}
