import { Groq } from "groq-sdk";

// 🛡️ VERCEL CONFIG: Prevents the 10-second timeout error!
export const config = {
  maxDuration: 60, 
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 🕸️ Helper Function to Search the Web using Tavily
async function performWebSearch(query) {
  try {
    if (!process.env.TAVILY_API_KEY) return "Error: TAVILY_API_KEY is missing in Vercel.";
    
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
    if (data.results) {
      return data.results.map(r => `Title: ${r.title}\nContent: ${r.content}\nURL: ${r.url}`).join('\n\n');
    }
    return data.answer || "No relevant information found on the internet.";
  } catch (error) {
    return "Failed to fetch search results.";
  }
}

export default async function handler(req, res) {
  // CORS Headers just in case
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body;
    let apiMessages = body.messages || [];

    const masterPrompt = `
You are Bimo AI, the official portfolio assistant for Bimochan Acharya (a Full-stack developer & CS student). You are a highly advanced AI Agent with real-time internet access.

DEFAULT BEHAVIOR:
- Be friendly, frank, and conversational.
- If asked about recent news, current events, real-time data, or things you don't know, YOU MUST use the 'search_web' tool.
- When you use search results, cite your sources briefly (e.g., "According to [Website Name]...").

ELITE DEVELOPER MODE:
- If asked to code, act as a 10x Staff Software Engineer. 
- ALWAYS write the FULL code. NO placeholders (like "// TODO").
- For Web UIs, combine HTML/CSS/JS into a single \`\`\`html block. Use modern, futuristic UI/UX (Glassmorphism, fluid animations).
- Outline logic under "### 🤔 Thinking Process" before providing the "### 🎯 Solution".
    `;

    apiMessages.unshift({ role: "system", content: masterPrompt });

    // 🛠️ Define the Web Search Tool for Groq
    const tools = [
      {
        type: "function",
        function: {
          name: "search_web",
          description: "Search the internet for real-time information, news, weather, or facts.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "The exact search query to look up on Google/Bing." }
            },
            required: ["query"]
          }
        }
      }
    ];

    // 🚀 STEP 1: Ask the AI to answer (and give it the tools)
    let response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: apiMessages,
      tools: tools,
      tool_choice: "auto",
      max_tokens: 6000,
    });

    let responseMessage = response.choices[0].message;

    // 🔍 STEP 2: Did the AI decide to search the web?
    if (responseMessage.tool_calls) {
      apiMessages.push(responseMessage); // Save the tool call to history

      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.function.name === "search_web") {
          const args = JSON.parse(toolCall.function.arguments);
          const searchResults = await performWebSearch(args.query);

          // Feed the website results back to the AI
          apiMessages.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: "search_web",
            content: searchResults
          });
        }
      }

      // 🧠 STEP 3: Ask the AI to write the final answer using the search results
      response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: apiMessages,
        max_tokens: 6000,
      });

      responseMessage = response.choices[0].message;
    }

    // 🎯 STEP 4: Send the final answer to your frontend
    return res.status(200).json({ reply: responseMessage.content });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: "Something went wrong.", details: error.message });
  }
}
