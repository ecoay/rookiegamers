// Ask Grok to build or publish a RookieGamers game, with the RookieGamers MCP server as its tool.
// XAI_API_KEY=... ROOKIEGAMERS_API_KEY=rgk_... node grok-agent.mjs "your request"
const prompt = process.argv.slice(2).join(' ') || 'List the games on RookieGamers.';
const site = (process.env.ROOKIEGAMERS_URL || 'https://rookiegamers.com').replace(/\/$/, '');
const r = await fetch('https://api.x.ai/v1/responses', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.XAI_API_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({
    model: process.env.XAI_MODEL || 'grok-4.7',
    instructions: 'You build web games on the RookieGamers SDK. Call get_sdk_docs first. Use scaffold_game for new games. Publish with create_game, upload_files and publish_game, and finish with the live URL.',
    input: [{ role: 'user', content: prompt }],
    tools: [{ type: 'mcp', server_url: `${site}/mcp`, server_label: 'rookiegamers', authorization: process.env.ROOKIEGAMERS_API_KEY }],
  }),
});
const j = await r.json();
if (!r.ok) { console.error(JSON.stringify(j, null, 2)); process.exit(1); }
for (const item of j.output || []) {
  if (item.type === 'mcp_call') console.log(`[tool] ${item.name}`);
  if (item.type === 'message') for (const c of item.content || []) if (c.text) console.log(c.text);
}
