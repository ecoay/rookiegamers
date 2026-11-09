# RookieGamers for Codex

1. Add the MCP server and sign in with your RookieGamers developer account in the browser:

```
codex mcp add rookiegamers --url https://rookiegamers.com/mcp
codex mcp login rookiegamers
```

2. Or use an API key instead: make one at https://rookiegamers.com/dev, `export ROOKIEGAMERS_API_KEY=rgk_...`, and add this to `~/.codex/config.toml` (or a project's `.codex/config.toml`):

```toml
[mcp_servers.rookiegamers]
url = "https://rookiegamers.com/mcp"
bearer_token_env_var = "ROOKIEGAMERS_API_KEY"
```

3. Copy [AGENTS.md](AGENTS.md) into your game's folder (or append it to an existing one) so Codex follows the SDK rules.
4. Ask: "Make a one-button rhythm game and publish it on RookieGamers."
