import { Groq } from "groq-sdk";

export const config = {
  maxDuration: 60,
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function performWebSearch(query) {
  try {
    if (!process.env.TAVILY_API_KEY) return "Error: TAVILY_API_KEY is missing.";

    console.log(`🔍 Searching web for: "${query}"`);
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        search_depth: "basic",
        include_answer: true,
        max_results: 3,
      }),
    });

    // Guard: if Tavily itself returns non-JSON, don't crash
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return "Search service returned an unreadable response.";
    }

    if (data.results && data.results.length > 0) {
      return data.results
        .map((r) => `Title: ${r.title}\nContent: ${r.content}\nURL: ${r.url}`)
        .join("\n\n");
    }
    return data.answer || "No relevant information found on the internet.";
  } catch (error) {
    console.error("Web search error:", error);
    return "Failed to fetch search results.";
  }
}

// Helper: always send a well-formed JSON response
function sendJSON(res, status, payload) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return sendJSON(res, 405, { error: "Method not allowed" });

  // Guard: parse body safely
  let body;
  try {
    body = typeof req.body === "object" ? req.body : JSON.parse(req.body);
  } catch {
    return sendJSON(res, 400, { error: "Invalid JSON in request body." });
  }

  try {
    let rawMessages = body.messages || [];
    let apiMessages = rawMessages.slice(-10);

    const masterPrompt = `
You are Bimo AI — the official AI assistant for Bimochan Acharya's portfolio.

ROLE:
Represent Bimochan professionally. Help users understand his work, skills, and projects, while also answering general questions intelligently.

CORE BEHAVIOR:
- Be clear, precise, and honest
- Think before answering
- Match user level (beginner ↔ expert)
- Avoid filler and generic phrases

REASONING:
Use the right thinking style when needed:
- Analytical → break problems down
- Critical → check for errors/assumptions
- Creative → explore better approaches
- Practical → give actionable answers

Do not over-explain simple questions.

TRUTH POLICY:
- Do not hallucinate facts, links, or data
- If unsure, say so
- Use web search when needed

COMMUNICATION:
- Start with the answer
- Then explanation if needed
- Keep responses clean and structured

ABOUT BIMOCHAN:
If asked about Bimochan:
- Answer professionally and warmly
- If unknown, say so or suggest contacting him

You are useful, not performative.
`;

    apiMessages.unshift({ role: "system", content: masterPrompt });

    const tools = [
      {
        type: "function",
        function: {
          name: "internetSearch",
          description: "Search the internet for real-time information.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The search query." },
            },
            required: ["query"],
          },
        },
      },
    ];

    let responseMessage;

    // STEP 1: Initial AI call with hallucination interception
    try {
      let response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: apiMessages,
        tools: tools,
        tool_choice: "auto",
        parallel_tool_calls: false,
        max_tokens: 6000,
      });
      responseMessage = response.choices[0].message;
    } catch (apiErr) {
      const errText = apiErr.message || apiErr.toString();

      if (errText.includes("failed_generation") || errText.includes("tool_use_failed")) {
        console.log("Intercepted hallucination, attempting recovery...");

        const match = errText.match(/query[^:]*:\s*\\?["']([^"'\\]+)/i);

        if (match && match[1]) {
          const extractedQuery = match[1].trim();
          console.log("Extracted hidden query:", extractedQuery);

          const searchResults = await performWebSearch(extractedQuery);

          apiMessages.push({
            role: "system",
            content: `[System Update] Web search results for "${extractedQuery}":\n\n${searchResults}\n\nPlease summarize this information clearly for the user.`,
          });

          let recoveryResponse = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: apiMessages,
            max_tokens: 6000,
          });

          return sendJSON(res, 200, {
            reply: recoveryResponse.choices[0].message.content,
          });
        }

        // Recovery failed gracefully
        return sendJSON(res, 200, {
          reply: "I ran into a hiccup processing that request. Could you try rephrasing it?",
        });
      }

      console.error("Groq API error:", errText);
      return sendJSON(res, 500, {
        error: "The AI service encountered an error.",
        details: errText,
      });
    }

    // STEP 2: Standard Tool Handling
    if (responseMessage.tool_calls) {
      apiMessages.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls) {
        let argsString = toolCall.function.arguments || "{}";
        let toolName = toolCall.function.name;

        if (toolName.includes("{")) {
          const bracketIndex = toolName.indexOf("{");
          argsString = toolName.substring(bracketIndex);
        }

        let args = { query: "latest news" };
        try {
          args = JSON.parse(argsString);
        } catch (e) {
          console.warn("Could not parse tool args:", argsString);
        }

        const searchResults = await performWebSearch(args.query);

        apiMessages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: toolCall.function.name,
          content: searchResults,
        });
      }

      // STEP 3: Final AI call after tool results
      let finalResponse = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: apiMessages,
        max_tokens: 6000,
      });
      responseMessage = finalResponse.choices[0].message;
    }

    return sendJSON(res, 200, { reply: responseMessage.content });
  } catch (error) {
    console.error("Fatal Backend Error:", error);
    return sendJSON(res, 500, {
      error: "An error occurred in the AI backend.",
      details: error.message || error.toString(),
    });
  }
}
