#!/usr/bin/env node
import { startServer } from '../index.js';
import { loadOrCreateToken } from '../auth.js';

function parseArgs(argv: string[]): { port: number; host: string; cwd: string; token?: string } {
  let port = 8080;
  let host = '127.0.0.1';
  let cwd = process.cwd();
  let token: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--port' || a === '-p') && argv[i + 1]) port = Number(argv[++i]);
    else if (a === '--host' && argv[i + 1]) host = argv[++i];
    else if (a === '--cwd' && argv[i + 1]) cwd = argv[++i];
    else if (a === '--token' && argv[i + 1]) token = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        [
          'claudecode-web — self-hosted web UI for Claude Code',
          '',
          'Usage: claudecode-web [options]',
          '',
          'Options:',
          '  --port, -p <n>   Port to bind (default 8080)',
          '  --host <addr>    Bind address (default 127.0.0.1 — do not change unless you know why)',
          '  --cwd <path>     Default project directory for new sessions (default: current dir)',
          '  --token <value>  Fixed access token (or set CLAUDECODE_WEB_TOKEN)',
          '  --help, -h       Show this help',
        ].join('\n')
      );
      process.exit(0);
    }
  }
  return { port, host, cwd, token };
}

async function main() {
  const { port, host, cwd, token: argToken } = parseArgs(process.argv);
  const token = argToken ?? process.env.CLAUDECODE_WEB_TOKEN ?? loadOrCreateToken();

  await startServer({ host, port, token, defaultCwd: cwd });

  const url = `http://${host}:${port}/?t=${token}`;
  const tunnelHint = `ssh -L ${port}:${host}:${port} <your-user>@<your-remote-host>`;
  const localUrl = `http://localhost:${port}/?t=${token}`;

  const banner = [
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `  claudecode-web listening on ${host}:${port}`,
    `  project: ${cwd}`,
    '',
    '  If Claude Code is on this computer:',
    `    open ${localUrl}`,
    '',
    '  If this is a remote server:',
    `    ${tunnelHint}`,
    `    then open ${url.replace(host, 'localhost')}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ].join('\n');
  process.stdout.write(banner);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
