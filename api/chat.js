export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      return res.status(200).json({ ok: true });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing API key" });
    }

    const { messages = [] } = req.body;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 1024,
        messages
      })
    });

    const data = await response.json();

    let reply = "";
    for (const block of data.content || []) {
      if (block.type === "text") reply += block.text;
    }

    return res.status(200).json({ reply: reply || "No response" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
