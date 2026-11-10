# RookieGamers for Grok

**Grok Build (CLI):** `grok mcp add --transport http rookiegamers https://rookiegamers.com/mcp`, then sign in with your RookieGamers developer account when the browser opens.

**xAI API:** the API can't open a sign-in page, so use an API key from https://rookiegamers.com/dev.

Grok connects to remote MCP servers through the xAI API. Add RookieGamers as an `mcp` tool and Grok can read the SDK docs, scaffold a game, and publish it.

```json
{
  "model": "grok-4.7",
  "input": [{ "role": "user", "content": "Make a tiny snake game on the RookieGamers SDK and publish it as snake-rookie." }],
  "tools": [
    {
      "type": "mcp",
      "server_url": "https://rookiegamers.com/mcp",
      "server_label": "rookiegamers",
      "server_description": "Build and publish web games on RookieGamers",
      "authorization": "rgk_...your key..."
    }
  ]
}
```

POST that to `https://api.x.ai/v1/responses` with your xAI key. [grok-agent.mjs](grok-agent.mjs) does it from the command line:

```
XAI_API_KEY=... ROOKIEGAMERS_API_KEY=rgk_... node grok-agent.mjs "Make a tiny snake game and publish it as snake-rookie"
```

The xAI docs describe `authorization` as the token sent in the Authorization header. If your requests come back unauthorized, send `"headers": { "Authorization": "Bearer rgk_..." }` instead.
