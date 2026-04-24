# Contributing

Thanks for helping improve Claude Code Web.

## Development

```bash
npm install
npm test
npm run build
```

Keep changes focused. This project is intentionally single-user and
localhost/SSH-tunnel first; multi-user auth and public deployments should be
discussed before implementation.

## Pull Requests

- Include tests for behavior changes when practical.
- Do not commit real SSH hosts, tokens, local transcripts, or project secrets.
- Keep skins UI-only. Skins should not inject persona prompts into Claude.
- Run `npm test` and `npm run build` before opening a PR.
