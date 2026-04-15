import { Groq } from "groq-sdk";

export const config = { maxDuration: 60 };

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* =========================
   🔐 TIMEOUT WRAPPER
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
   🧠 SAFE AI CALL (RETRY SYSTEM)
========================= */
async function safeAICall(messages, max_tokens = 1000, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await withTimeout(
        groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages,
          max_tokens,
        }),
        25000
      );

      const content = res?.choices?.[0]?.message?.content;

      if (content && content.trim().length > 0) {
        return content;
      }

      console.warn(`⚠️ Empty response attempt ${i + 1}`);
    } catch (err) {
      console.error(`❌ AI error attempt ${i + 1}:`, err.message);
    }
  }

  return null;
}

/* =========================
   📤 RESPONSE HELPER
========================= */
function sendJSON(res, status, payload) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(payload);
}

/* =========================
   🧠 MASTER PROMPT
========================= */
const masterPrompt = `
You are Bimo AI — assistant for Bimochan Acharya and senior frontend engineer.

GENERAL:
- Be precise, useful, and honest
- Avoid hallucinations

BUILDER MODE:
- Use React + Tailwind only
- Modular components
- Clean production structure
- No plain HTML apps
`;

/* =========================
   🧩 BUILDER PIPELINE
========================= */

async function generatePlan(messages) {
  return (
    (await safeAICall(
      [
        ...messages,
        {
          role: "system",
          content:
            "Create a short web app plan (pages, components, features).",
        },
      ],
      500
    )) || "⚠️ Plan generation failed."
  );
}

async function generateComponents(plan) {
  return (
    (await safeAICall(
      [
        {
          role: "system",
          content:
            "Generate React + Tailwind components with filenames. Keep clean and modular.",
        },
        { role: "user", content: plan },
      ],
      900
    )) || "⚠️ Component generation failed."
  );
}

async function assembleProject(components) {
  return (
    (await safeAICall(
      [
        {
          role: "system",
          content:
            "Generate minimal React project structure (App.jsx, folders, setup).",
        },
        { role: "user", content: components },
      ],
      900
    )) || "⚠️ Project generation failed."
  );
}

/* =========================
   🖥️ HTML PREVIEW EXTRACTOR
========================= */
function extractHTMLPreview(text) {
  const match = text?.match(/```(?:html|jsx|tsx)?([\s\S]*?)```/i);
  return match ? match[1] : null;
}

/* =========================
   🚀 MAIN HANDLER
========================= */
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
    const userMessage =
      rawMessages[rawMessages.length - 1]?.content || "";

    let apiMessages = rawMessages.slice(-5);

    if (!apiMessages.some((m) => m.role === "system")) {
      apiMessages.unshift({ role: "system", content: masterPrompt });
    }

    const isBuilder =
      /build|create|website|web app|portfolio|landing page/i.test(
        userMessage
      );

    /* =========================
       🧠 BUILDER MODE
    ========================= */
    if (isBuilder) {
      const plan = await generatePlan(apiMessages);
      const components = await generateComponents(plan);
      const project = await assembleProject(components);

      const finalReply = `
🚀 PLAN:
${plan}

🧩 COMPONENTS:
${components}

📦 PROJECT:
${project}
      `;

      const previewCode =
        extractHTMLPreview(project) ||
        `<div style="padding:20px;font-family:sans-serif;">
          <h2>Preview Not Available</h2>
          <p>Code generated successfully but no HTML preview detected.</p>
        </div>`;

      return sendJSON(res, 200, {
        reply:
          finalReply && finalReply.trim().length > 0
            ? finalReply
            : "⚠️ Failed to generate project.",
        preview: previewCode,
      });
    }

    /* =========================
       🤖 NORMAL CHAT MODE
    ========================= */
    const response = await safeAICall(apiMessages, 1000);

    return sendJSON(res, 200, {
      reply: response || "⚠️ No response from AI.",
    });
  } catch (error) {
    console.error("Fatal Error:", error);

    return sendJSON(res, 500, {
      error: "Server error",
      details: error.message,
    });
  }
}
