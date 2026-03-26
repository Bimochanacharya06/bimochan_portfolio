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
    return "Failed to fetch search results.";
  }
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body;
    let rawMessages = body.messages || [];
    let apiMessages = rawMessages.slice(-10);
    const masterPrompt = `
You are Bimo AI, the highly advanced, official portfolio AI assistant for Bimochan Acharya.

=========================================
🧠 KNOWLEDGE BASE: WHO IS BIMOCHAN ACHARYA?
- Bimochan Acharya is a talented Full-stack Developer and Computer Science student.
- He is the creator of you (Bimo AI) and this futuristic portfolio website.
- Focus on his identity as a passionate developer and tech innovator.
=========================================

🗣️ COMMUNICATION STYLE & VIBE MATCHING:
- DYNAMIC TONE: You must match the user's energy! If they speak casually (e.g., saying "bro", "wassup", or using slang), reply like a cool, relatable developer friend ("I got you bro!", "Let's go!"). If they speak formally, reply professionally. 
- Core Personality: Always remain highly encouraging, confident, and helpful.
- Formatting: ALWAYS use beautiful markdown. Use emojis for section headers (e.g., 🔍, 🛠️, 🚀).
- Structure: Break your answers into clear, logical sections.

DEFAULT BEHAVIOR & WEB SEARCH:
- If the user asks about real-time news, current events, specific people, or facts you don't know, use your internetSearch feature.
- When you receive web search results, READ the content and write a natural, authentic summary. Do not just list links.
- Use small markdown citations: [Source](URL).

💻 ELITE DEVELOPER MODE:
- ALWAYS write FULL code. NO placeholders.
- Combine HTML/CSS/JS into a single \`\`\`html block.
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
              query: { type: "string", description: "The search query." }
            },
            required: ["query"]
          }
        }
      }
    ];

    let responseMessage;

    // 🚀 STEP 1: The Bulletproof Wrapper
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
      // 🚨 THE FIXED INTERCEPTOR: Now accurately reads the JS Error object!
      const errText = apiErr.message || apiErr.toString();
      
      if (errText.includes("failed_generation") || errText.includes("tool_use_failed")) {
        console.log("Intercepted hallucination!");
        
        // Smarter Regex: Ignores backslashes (\") and extracts the text perfectly
        const match = errText.match(/query[^:]*:\s*\\?["']([^"'\\]+)/i);
        
        if (match && match[1]) {
           const extractedQuery = match[1].trim();
           console.log("Successfully extracted hidden query:", extractedQuery);
           
           const searchResults = await performWebSearch(extractedQuery);

           // Feed the results back directly as a system message
           apiMessages.push({
             role: "system",
             content: `[System Update] Web search results for "${extractedQuery}":\n\n${searchResults}\n\nPlease summarize this information beautifully for the user.`
           });

           // Run a clean recovery call WITHOUT tools to guarantee no crashes
           let recoveryResponse = await groq.chat.completions.create({
             model: "llama-3.3-70b-versatile",
             messages: apiMessages,
             max_tokens: 6000,
           });
           
           return res.status(200).json({ reply: recoveryResponse.choices[0].message.content });
        }
      }
      throw apiErr; // Throw only if it's a completely unrelated error
    }

    // 🔍 STEP 2: Standard Tool Handling
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
        try { args = JSON.parse(argsString); } catch (e) {}

        const searchResults = await performWebSearch(args.query);

        apiMessages.push({
          tool_call_id: toolCall.id,
          role: "tool",
          name: toolCall.function.name,
          content: searchResults
        });
      }

      // 🧠 STEP 3: Final AI Call
      let finalResponse = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: apiMessages,
        max_tokens: 6000,
      });
      responseMessage = finalResponse.choices[0].message;
    }

    return res.status(200).json({ reply: responseMessage.content });

  } catch (error) {
    console.error("Fatal Backend Error:", error);
    return res.status(500).json({ 
      error: "An error occurred in the AI backend.", 
      details: error.message || error.toString() 
    });
  }
}
