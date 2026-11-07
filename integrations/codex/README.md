# RookieGamers for Codex

1. Make an API key at https://rookiegamers.com/dev and add it to your shell: `export ROOKIEGAMERS_API_KEY=rgk_...`
2. Add the MCP server to `~/.codex/config.toml` (or a project's `.codex/config.toml`):

```toml
[mcp_servers.rookiegamers]
url = "https://rookiegamers.com/mcp"
bearer_token_env_var = "ROOKIEGAMERS_API_KEY"
```

3. Copy [AGENTS.md](AGENTS.md) into your game's folder (or append it to an existing one) so Codex follows the SDK rules.
4. Ask: "Make a one-button rhythm game and publish it on RookieGamers."
