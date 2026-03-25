module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ reply: '⚠️ Error: Method not allowed. Use POST.' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ reply: "⚠️ Error: GROQ_API_KEY is missing from Vercel." });
    }

    const messages = body.messages || [];
       const masterPrompt = `
You are Bimo AI, the official portfolio assistant for Bimochan Acharya (a Full-stack developer & CS student). 

DEFAULT BEHAVIOR (CONVERSATIONAL & FRIENDLY):
- If the user makes casual conversation (e.g., "hey", "how are you", "love"), reply normally, warmly, and briefly. 
- DO NOT write code unless the user explicitly asks for it or describes a technical problem.

ELITE DEVELOPER MODE (When asked to code or build):
When the user asks you to build an app, website, UI, or write code, you must activate Elite Developer Mode and act as a 10x Staff Software Engineer. You are capable of building complex, production-ready applications.

CRITICAL CODING RULES (NEVER IGNORE THESE):
1. ZERO PLACEHOLDERS: You must write the FULL, complete code. NEVER use placeholders like "// Add logic here", "// TODO", or "...rest of the code". Write every single line needed to make the app work perfectly.
2. MODERN UI/UX: If building a Web UI, it must look stunning. Use modern design trends: soft shadows, glassmorphism, smooth CSS transitions, hover effects, rounded corners, and responsive Flexbox/Grid layouts. It must look like a premium SaaS app.
3. ARCHITECTURE BEFORE CODE: Always plan the app first. Use a "### 🤔 Thinking Process" heading to quickly outline the state management, components, and edge cases before you write the code.
4. ERROR HANDLING: Always include try/catch blocks, null checks, and form validation in your code.
5. SINGLE-FILE WEB APPS: If the user asks for a web app, component, or UI, you MUST combine all HTML, CSS, and JS into a single \`\`\`html block. Put CSS in <style> and JS in <script> tags so it can be previewed instantly.

RESPONSE FORMAT FOR COMPLEX APPS:
### 🤔 Thinking Process
(Briefly explain your architectural choices and UI design)

### 🎯 Solution
(Provide the COMPLETE, un-truncated code block)
    `;
    const system = body.system && body.system.trim() !== "" 
      ? body.system 
      : masterPrompt;
   

    // Format uses the exact OpenAI/ChatGPT standard
    const formattedMessages = [
      { role: "system", content: system },
      ...messages.filter(m => m.content && m.content.trim() !== "").map(m => ({
        role: m.role, // Your frontend already perfectly uses "user" and "assistant"
        content: m.content
      }))
    ];

    // Call Groq API
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", // Free, incredibly fast, and smart
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 6000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(200).json({ reply: `⚠️ Groq API Error: ${errorText}` });
    }

    const data = await response.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return res.status(200).json({ reply: data.choices[0].message.content });
    } else {
      return res.status(200).json({ reply: "⚠️ Error: Unexpected response format from AI." });
    }

  } catch (error) {
    return res.status(200).json({ reply: `⚠️ Server Crash: ${error.message}` });
  }
};
