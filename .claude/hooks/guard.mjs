#!/usr/bin/env node
// Safety guard for Claude Code (PreToolUse hook). Blocks:
//   • writing files outside this project folder (or into the guard/settings themselves)
//   • shell commands that can damage the computer or publish things
// Exit code 2 = block; the message on stderr is shown to Claude so it can adjust.
import path from 'node:path';

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const PROTECTED = ['.claude/settings.json', '.claude/hooks'];

const DANGEROUS = [
  [/\bsudo\b|\bsu\s+-|\brunas\b/i, 'administrator/root commands'],
  [/\b(rm|del|rmdir|Remove-Item)\b.*[ \t](\/|~|\$HOME|\.\.\/?|[A-Za-z]:\\)\S*/i, 'deleting files outside the project'],
  [/\bmkfs|\bdd\s+if=|\bformat\s+[A-Za-z]:|\bdiskpart\b/i, 'disk formatting'],
  [/\b(shutdown|reboot|halt|poweroff)\b/i, 'shutting down the computer'],
  [/\bchmod\s+-R\b|\bchown\b|\btakeown\b|\bicacls\b/i, 'changing file ownership/permissions'],
  [/\b(curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b.*\|\s*(ba|z)?sh\b|\|\s*iex\b/i, 'running scripts downloaded from the internet'],
  [/\bnpm\s+(i|install|add)\s+.*(-g|--global)\b|\b(yarn|pnpm)\s+(global\s+add|add\s+-g)/i, 'installing global packages'],
  [/\bnpm\s+publish\b|\bgit\s+push\b/i, 'publishing or pushing'],
  [/\b(reg\s+(add|delete)|setx|crontab|launchctl|systemctl)\b/i, 'changing system settings'],
  [/:\(\)\s*\{.*\};\s*:/, 'fork bomb'],
];

const block = (reason) => {
  process.stderr.write(`Blocked by project safety guard: ${reason}.\n`);
  process.exit(2);
};

const isInsideProject = (file) => {
  const rel = path.relative(PROJECT, path.resolve(PROJECT, file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // not our business
}
const { tool_name: tool, tool_input: args = {} } = input;

if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const file = args.file_path || args.notebook_path;
  if (file && !isInsideProject(file)) block(`"${file}" is outside the project folder — only edit files inside ${PROJECT}`);
  const rel = file && path.relative(PROJECT, path.resolve(PROJECT, file)).replaceAll('\\', '/');
  if (rel && PROTECTED.some((p) => rel === p || rel.startsWith(p + '/')))
    block(`"${rel}" holds the safety settings; ask your instructor if it really needs changing`);
}

if (tool === 'Bash' || tool === 'PowerShell') {
  const cmd = args.command || '';
  // Check line by line, so text in a heredoc on one line can't combine with the next line.
  for (const line of cmd.split(/\r?\n/))
    for (const [pattern, what] of DANGEROUS) if (pattern.test(line)) block(`${what} are not allowed in this exam ("${line.trim()}")`);
}

process.exit(0);
