# Listing the RookieGamers MCP server in the AI app stores

The server is `https://rookiegamers.com/mcp`. AI apps sign developers in with OAuth (dynamic client registration or a client ID metadata document, PKCE S256, no client secret), so there is nothing to allowlist and no keys to hand to any store. Tool titles and read-only/destructive labels are set on every tool.

## Before any submission (once)

1. **Review access code.** In the Cloudflare dashboard, add a secret `REVIEW_LOGIN_CODE` to the `rookiegamers` Worker: any random string of 16+ characters. Reviewers then sign in to a sandbox developer account ("AppReviewer") from the sign-in step of the connect flow, with no email codes or two-factor prompts. Give the code to each store in its private test-account field. Delete the secret to switch it off.
2. **Try it yourself** in Claude: Settings → Connectors → Add custom connector → `https://rookiegamers.com/mcp`, sign in, and run each tool once (the stores ask you to confirm you did this).

Test-account text to paste (all three stores):

> Connect the server, and when the RookieGamers sign-in page opens, click "Use the review access code" and enter: (the code). Then click Allow. The account is a sandbox developer, so it can create, upload and publish test games.

Sample prompts (Grok wants 2–3, Claude wants a few, ChatGPT's five are in `openai/plugin.json`):

1. "How do I submit a score to a RookieGamers leaderboard?" → reads the SDK docs and explains `rg.scores.submit`.
2. "Make a tiny one-button game on the RookieGamers SDK and publish it as review-test." → `scaffold_game`, `create_game`, `upload_files`, `publish_game`; the game is live at rookiegamers.com/play/review-test.
3. "Which of my RookieGamers games are live, and how many plays did they get?" → `list_my_games`, `game_stats`.

## Claude (Connectors Directory)

- Where: https://claude.ai/directory/manage → Submit new → MCP connector. Needs a paid Claude plan.
- URL: `https://rookiegamers.com/mcp` (Universal URL). Auth: OAuth with DCR (it is detected automatically).
- Name: RookieGamers. One-liner: "Build web games on the RookieGamers SDK and publish them to rookiegamers.com."
- Description: use the long description in `openai/plugin.json`.
- Categories: Developer tools, Entertainment. Docs: https://rookiegamers.com/docs. Privacy: https://rookiegamers.com/privacy. Support: support@rookiegamers.com.
- Icon: `public/brand/rookiegamers-logo-512.png`.
- Test account: the review access code text above.
- Review: automatic scan first, sometimes a human review; no fixed timeline.

## ChatGPT (OpenAI plugin directory)

- Personally first: verify your identity or Tenacié LLC in the OpenAI Platform dashboard (Settings → Organization → Verification), under the exact name the plugin will publish as (`developerName` in `openai/plugin.json`). You need owner or "Apps Management Write" access.
- Domain check: the portal shows a token. Add it in Cloudflare as a variable `OPENAI_APPS_CHALLENGE` on the `rookiegamers` Worker; it is then served at `https://rookiegamers.com/.well-known/openai-apps-challenge`.
- Upload: zip the contents of `integrations/openai` (`plugin.json` and `mcp.json` at the zip root, plus `assets/`) and upload it at https://platform.openai.com/plugins. On Windows: open the folder, select all, Send to → Compressed (zipped) folder.
- Then: connect the server and authorize the scan account (use the review code), wait for the tool scan, fill in Review details (test account text above), record a short demo video and add its link, accept the attestations, submit. After approval, click Publish.
- Check `review.test_cases` and `publication.countries` in `plugin.json` before uploading.

## Grok (xAI plugin marketplace)

- Where: https://x.ai/bot/marketplace/submit-a-plugin. One form covers Grok Bot and Cursor today; Grok itself is listed as "coming soon".
- Organization handle: `rookiegamers`. Website: https://rookiegamers.com. Logo URL: https://rookiegamers.com/brand/rookiegamers-logo-512.png.
- MCP server URL: `https://rookiegamers.com/mcp`. Short description: "Build web games on the RookieGamers SDK and publish them to rookiegamers.com."
- Testing instructions: the review access code text and the three sample prompts above.
- Submitting accepts Cursor's Marketplace Publisher Terms. No published review timeline.
