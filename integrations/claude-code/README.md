# RookieGamers for Claude Code

A plugin with the RookieGamers MCP server, a skill for building on the SDK, and a `/rg-publish` command.

1. Make an API key at https://rookiegamers.com/dev and add it to your shell: `export ROOKIEGAMERS_API_KEY=rgk_...`
2. In Claude Code:

```
/plugin marketplace add ecoay/rookiegamers
/plugin install rookiegamers@rookiegamers
```

3. Ask for a game: "Make a one-button rhythm game and publish it on RookieGamers."

Just the MCP server, without the plugin:

```
claude mcp add --transport http rookiegamers https://rookiegamers.com/mcp --header "Authorization: Bearer $ROOKIEGAMERS_API_KEY"
```
