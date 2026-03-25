module.exports = async function (req, res) {
  // 1. Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ reply: '⚠️ Error: Method not allowed. Use POST.' });
  }

  try {
    // 2. Safely parse the body
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const messages = body.messages || [];
    
    // Fallback system prompt if none is provided
    const system = body.system && body.system.trim() !== "" 
      ? body.system 
      : "You are Bimo AI, a helpful portfolio assistant for Bimochan Acharya.";

    // 3. Ensure the API key exists
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ 
        reply: "⚠️ Error: GEMINI_API_KEY is missing from Vercel Environment Variables." 
      });
    }

    // 4. Format messages for Gemini (Gemini uses 'user' and 'model' instead of 'assistant')
    const formattedMessages = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    })).filter(m => m.parts[0].text && m.parts[0].text.trim() !== "");

    if (formattedMessages.length === 0) {
      return res.status(200).json({ reply: "⚠️ Error: No message content received." });
    }

    // 5. Call Google Gemini API (Using the rock-solid -latest endpoint)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: formattedMessages,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        }
      })
    });

    // 6. Handle API errors safely
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API Error:", errorText);
      return res.status(200).json({ 
        reply: `⚠️ Gemini API Error: ${errorText}` 
      });
    }

    // 7. Parse the successful response
    const data = await response.json();

    // 8. Extract Gemini's text response
    if (data.candidates && data.candidates[0] && data.candidates[0].content.parts[0].text) {
      const botReply = data.candidates[0].content.parts[0].text;
      return res.status(200).json({ reply: botReply });
    } else {
      console.error("Unexpected Gemini Data:", JSON.stringify(data));
      return res.status(200).json({ reply: "⚠️ Error: Gemini returned an unexpected response format." });
    }

  } catch (error) {
    console.error("Backend Crash:", error);
    return res.status(200).json({ 
      reply: `⚠️ Server Crash: ${error.message}` 
    });
  }
};
