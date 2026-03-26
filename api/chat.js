import { Groq } from "groq-sdk";

export const config = {
  maxDuration: 60, 
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function performWebSearch(query) {
  try {
    if (!process.env.TAVILY_API_KEY) return "Error: TAVILY_API_KEY is missing.";
    
    console.log(`🔍 Searching web for: "${query}"`);
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        search_depth: "basic",
        include_answer: true,
        max_results: 3
      })
    });
    
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return data.results.map(r => `Title: ${r.title}\nContent: ${r.content}\nURL: ${r.url}`).join('\n\n');
    }
    return data.answer || "No relevant information found on the internet.";
  } catch (error) {
    return "Failed to fetch search results. The internet might be temporarily unreachable.";
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body;
    let rawMessages = body.messages || [];

    // 🛡️ FUTURE-PROOF FIX 1: Trim history to last 10 messages so the AI never runs out of memory (Context Window)
    let apiMessages = rawMessages.slice(-10);

    const masterPrompt = `
You are Bimo AI, the highly advanced, official portfolio AI assistant for Bimochan Acharya.

=========================================
🧠 KNOWLEDGE BASE: WHO IS BIMOCHAN ACHARYA?
- Bimochan Acharya is a talented Full-stack Developer and Computer Science student.
- He is the creator of you (Bimo AI) and this futuristic portfolio website.
- Focus on his identity as a passionate developer and tech innovator.
=========================================

🗣️ COMMUNICATION STYLE:
- Tone: Highly encouraging, friendly, and expert.
- Formatting: ALWAYS use beautiful markdown. Use emojis for section headers (e.g., 🔍, 🛠️, 🚀).
- Structure: Break your answers into clear, logical sections. 

DEFAULT BEHAVIOR & WEB SEARCH:
- If the user asks about real-time news, current events, weather, or facts you don't know, search the internet to find the answer.
- When you receive web search results, READ the content and write a natural, authentic summary. Do not just list links.
- At the end of your points, use small markdown citations: [Source](URL).

💻 ELITE DEVELOPER MODE:
- If asked to code, act as a 10x Staff Software Engineer. 
- ALWAYS write FULL code. NO placeholders.
- Combine HTML/CSS/JS into a single \`\`\`html block. Use Glassmorphism and fluid animations.
    `;

    // Add Master Prompt to the very beginning
    apiMessages.unshift({ role: "system", content: masterPrompt });

    const tools = [
      {
        type: "function",
        function: {
          name: "search_web",
          description: "Search the internet for real-time information, news, weather, or facts.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The exact search query to look up." }
            },
            required: ["query"]
          }
        }
      }
    ];

    // 🚀 STEP 1: First AI Call
    let response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: apiMessages,
      tools: tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
      max_tokens: 6000,
    });

    let responseMessage = response.choices[0].message;

    // 🔍 STEP 2: Tool Handling with Hallucination Armor
    if (responseMessage.tool_calls) {
      apiMessages.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls) {
        let toolName = toolCall.function.name;
        let argsString = toolCall.function.arguments || "{}";

        // 🛡️ FUTURE-PROOF FIX 2: Catch Groq's "Merged Tool" Hallucination
        // If the AI accidentally smashes the JSON arguments into the tool name, we split it back out!
        if (toolName.includes("{")) {
          const bracketIndex = toolName.indexOf("{");
          argsString = toolName.substring(bracketIndex); 
          toolName = "search_web"; 
        }

        if (toolName === "search_web") {
          let args = { query: "" };
          try {
            args = JSON.parse(argsString);
          } catch (e) {
            console.error("Failed to parse tool arguments:", argsString);
            // Fallback if JSON is totally broken
            args.query = "latest news"; 
          }

          const searchResults = await performWebSearch(args.query);

          apiMessages.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: toolName,
            content: searchResults
          });
        }
      }

      // 🧠 STEP 3: Final AI Call
      response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: apiMessages,
        max_tokens: 6000,
      });

      responseMessage = response.choices[0].message;
    }

    return res.status(200).json({ reply: responseMessage.content });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ 
      error: "An error occurred in the AI brain.", 
      details: error.message 
    });
  }
}
