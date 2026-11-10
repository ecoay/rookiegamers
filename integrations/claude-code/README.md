# RookieGamers for Claude Code

A plugin with the RookieGamers MCP server, a skill for building on the SDK, and a `/rg-publish` command.

1. In Claude Code:

```
/plugin marketplace add ecoay/rookiegamers
/plugin install rookiegamers@rookiegamers
```

2. Run `/mcp`, pick `rookiegamers` and sign in with your RookieGamers developer account in the browser.
3. Ask for a game: "Make a one-button rhythm game and publish it on RookieGamers."

Just the MCP server, without the plugin:

```
claude mcp add --transport http rookiegamers https://rookiegamers.com/mcp
```

Prefer an API key (CI, or no browser)? Make one at https://rookiegamers.com/dev and add `--header "Authorization: Bearer $ROOKIEGAMERS_API_KEY"`.
