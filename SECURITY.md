# Security

Claude Code Web is intended for single-user use over localhost or an SSH tunnel.

## Supported Use

- Keep the server bound to `127.0.0.1`.
- Access remote servers through SSH port forwarding.
- Treat the web UI with the same trust level as the Claude Code CLI: it can ask
  Claude Code to read, edit, create, and delete project files.

## Do Not Commit

- SSH private keys or real SSH host details
- Claude, Anthropic, or provider API tokens
- `~/.claudecode-web/token`
- `.claude/`, `.claudecode-web/`, generated uploads, personal transcripts, or
  project-specific secrets

## Reporting

If you find a security issue, please do not open a public issue with secrets,
tokens, or exploit details. Contact the maintainers privately first.
