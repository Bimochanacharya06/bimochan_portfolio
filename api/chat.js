export default async function handler(req, res) {
  // 1. Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    // 2. Extract data sent from your frontend
    const { messages, system, web_search, code_mode } = req.body;

    // 3. Ensure the API key exists
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ 
        reply: "Error: ANTHROPIC_API_KEY is missing from Vercel Environment Variables." 
      });
    }

    // 4. Format messages for Anthropic (Claude requires alternating user/assistant roles)
    // We filter out any potential empty messages just to be safe.
    const formattedMessages = messages.filter(m => m.content && m.content.trim() !== "");

    // 5. Call the Anthropic Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022", // Fast and cost-effective model
        max_tokens: 2000, // Max length of response
        system: system, // Your custom prompt about Bimochan
        messages: formattedMessages,
        temperature: 0.7
      })
    });

    // 6. Handle API errors from Anthropic
    if (!response.ok) {
      const errorData = await response.json();
      console.error("Anthropic API Error:", errorData);
      return res.status(500).json({ 
        reply: `Anthropic API Error: ${errorData.error?.message || "Unknown error occurred"}` 
      });
    }

    // 7. Parse the successful response
    const data = await response.json();

    // 8. Extract Claude's text response
    if (data.content && data.content[0] && data.content[0].text) {
      const botReply = data.content[0].text;
      // Send it back to the frontend!
      return res.status(200).json({ reply: botReply });
    } else {
      throw new Error("Claude returned an unexpected response format.");
    }

  } catch (error) {
    console.error("Backend Crash:", error);
    return res.status(500).json({ 
      reply: `Backend Error: ${error.message}` 
    });
  }
}
