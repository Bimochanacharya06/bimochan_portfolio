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
    const system = body.system || "";

    // 3. Ensure the API key exists
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(200).json({ 
        reply: "⚠️ Error: ANTHROPIC_API_KEY is missing from Vercel Environment Variables." 
      });
    }

    // 4. Format messages (ensure no empty messages)
    const formattedMessages = messages.filter(m => m.content && m.content.trim() !== "");
    if (formattedMessages.length === 0) {
      return res.status(200).json({ reply: "⚠️ Error: No message content received." });
    }

    // 5. Call Anthropic Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1000, // Reduced slightly to prevent Vercel timeout
        system: system,
        messages: formattedMessages,
        temperature: 0.7
      })
    });

    // 6. Handle API errors from Anthropic
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API Error:", errorText);
      return res.status(200).json({ 
        reply: `⚠️ Anthropic API Error: ${errorText}` 
      });
    }

    // 7. Parse the successful response
    const data = await response.json();

    // 8. Extract Claude's text response
    if (data.content && data.content[0] && data.content[0].text) {
      const botReply = data.content[0].text;
      return res.status(200).json({ reply: botReply });
    } else {
      return res.status(200).json({ reply: "⚠️ Error: Claude returned an empty or unexpected response." });
    }

  } catch (error) {
    console.error("Backend Crash:", error);
    return res.status(200).json({ 
      reply: `⚠️ Server Crash: ${error.message}` 
    });
  }
};
