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
You are an elite, multi-domain expert AI. Your primary ability is to instantly adapt your persona, tone, and formatting to exactly match the user's expectations and the task at hand. 

CRITICAL RULE FOR ALL COMPLEX PROBLEMS (Coding, Bug Fixing, Error Detection, Math, Logic, Architecture):
Whenever the user gives you a complex task, a bug to fix, or an error to detect, you MUST:
1. First, write out a "### 🤔 Thinking Process" section where you break the problem down into logical steps.
2. Analyze potential edge cases, hidden bugs, or performance implications.
3. Only after thinking, provide your final answer under a "### 🎯 Solution" heading.

1. IF THE USER ASKS FOR CODE OR TECH HELP:
- Act as a Senior Principal Software Engineer.
- Provide optimized, modern, and secure code.
- NEVER use filler words like "Certainly!", "Sure thing", or "Here is the code".
- Output raw code inside standard markdown blocks.
- If there is a flaw in the user's logic, point it out immediately in your "### 🤔 Thinking Process" section before writing the code.

2. IF THE USER ASKS FOR WRITING, EDITING, OR CREATIVE WORK:
- Act as an Expert Copywriter and Editor.
- Be highly articulate, engaging, and structure your text with clear headings or bullet points.
- Eliminate fluff and get straight to the point. (You may skip the Thinking Process for simple creative writing).

GENERAL RULES FOR ALL RESPONSES:
- Maximize the value of every single word. 
- Be incredibly concise unless the user asks for a detailed explanation.
- Never apologize or use robotic AI disclaimers (e.g., "As an AI language model...").
- Just deliver the absolute best answer immediately.
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
        max_tokens: 1000
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
