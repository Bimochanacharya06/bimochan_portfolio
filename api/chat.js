const rateLimitStore = {};

function getClientIP(req) {
  return req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
}

function rateLimitCheck(ip) {
  const now = Date.now();
  const limit = 5;
  const windowMs = 60000;

  if (!rateLimitStore[ip]) {
    rateLimitStore[ip] = { count: 1, start: now };
    return { allowed: true };
  }

  const data = rateLimitStore[ip];

  if (now - data.start > windowMs) {
    rateLimitStore[ip] = { count: 1, start: now };
    return { allowed: true };
  }

  if (data.count >= limit) {
    return {
      allowed: false,
      reset_in: Math.ceil((windowMs - (now - data.start)) / 1000),
    };
  }

  data.count++;
  return { allowed: true };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    const ip = getClientIP(req);
    const rate = rateLimitCheck(ip);

    if (!rate.allowed) {
      return res.status(429).json({
        error: "Rate limited",
        retry_in: rate.reset_in
      });
    }

    const { messages = [] } = req.body;

    return res.status(200).json({
      reply: messages.length
        ? `Hello, ${messages[0].content}`
        : "Hello, world!"
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
