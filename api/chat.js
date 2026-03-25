const http = require("http");
const { URL } = require("url");
const https = require("https");
require("dotenv").config(); // Load environment variables

// Handles incoming requests
const requestHandler = (req, res) => {
  // Handle CORS preflight (OPTIONS request)
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Only POST requests are allowed" }));
    return;
  }

  // Read incoming request body
  let data = "";
  req.on("data", chunk => {
    data += chunk;
  });

  req.on("end", () => {
    try {
      const body = JSON.parse(data || "{}");

      // Check for API key in environment variables
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY missing in environment variables!" }));
        return;
      }

      // Format the message payload for Claude API
      const messages = [];
      if (body.system) {
        messages.push({ role: "system", content: body.system }); // Add system-level instructions
      }
      (body.messages || []).forEach(message => {
        messages.push({ role: message.role, content: message.content });
      });

      // API payload for Claude
      const payload = JSON.stringify({
        model: "claude-2", // Use the supported Claude model
        prompt: messages.map(m => `${m.role}: ${m.content}`).join("\n"), // Format into Claude's natural prompt
        max_tokens_to_sample: 100, // Adjust response length as needed
        temperature: 0.5, // Adjust creativity
      });

      // Send request to Anthropic Claude API
      const anthropicReqOptions = {
        hostname: "api.anthropic.com",
        path: "/v1/complete",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      };

      const anthropicReq = https.request(anthropicReqOptions, anthropicRes => {
        let responseBody = "";

        anthropicRes.on("data", chunk => {
          responseBody += chunk;
        });

        anthropicRes.on("end", () => {
          try {
            const parsedResponse = JSON.parse(responseBody);

            // Extract the AI response
            if (parsedResponse.completion) {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ reply: parsedResponse.completion }));
            } else {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "No reply received from Claude." }));
            }
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to process Claude API response." }));
          }
        });
      });

      // Handle request errors
      anthropicReq.on("error", err => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Claude API Request Error: ${err.message}` }));
      });

      // Write request data and send the API request
      anthropicReq.write(payload);
      anthropicReq.end();
    } catch (err) {
      // Handle general errors
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Server Error: ${err.message}` }));
    }
  });
};

// Create the Node.js HTTP server
const server = http.createServer(requestHandler);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
