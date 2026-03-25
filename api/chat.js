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
    const system = body.system && body.system.trim() !== "" 
      ? body.system 
      : "You are Bimo AI, a helpful portfolio assistant for Bimochan Acharya.";

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
