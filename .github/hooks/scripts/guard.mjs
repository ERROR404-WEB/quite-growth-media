#!/usr/bin/env node
// preToolUse guard for Copilot agent sessions (VS Code / Copilot CLI).
// Reads the event JSON on stdin and prints ONE JSON decision object:
//   {}                                              -> no opinion (normal permission flow)
//   {"permissionDecision":"ask"|"deny", ...Reason}  -> require approval / block
// Command preToolUse hooks are fail-closed on crashes, so every path exits 0 with valid JSON.
import { readFileSync } from 'node:fs';

const DENY = 'deny';
const ASK = 'ask';

/** Rules for shell commands. First match wins, so deny rules come before ask rules. */
const SHELL_RULES = [
  {
    decision: DENY,
    re: /\bdocker\s+compose\b[^\n]*\bdown\b[^\n]*(\s-v\b|--volumes\b)/i,
    why: 'Deletes the Postgres/n8n volumes (all local data).',
  },
  {
    decision: DENY,
    re: /\bdocker\s+(volume\s+(rm|prune)\b|system\s+prune\b[^\n]*--volumes\b)/i,
    why: 'Deletes Docker volumes (database, n8n data). Remove volumes manually only after a verified backup.',
  },
  {
    decision: DENY,
    re: /\bdrop\s+(database|schema)\b/i,
    why: 'Dropping databases/schemas must be done manually by the operator.',
  },
  {
    decision: DENY,
    re: /\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/i,
    why: 'Force-push is not allowed.',
  },
  { decision: DENY, re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i, why: 'Destroys uncommitted work.' },
  {
    decision: DENY,
    re: /\bgit\s+config\s+(--global|--system)\b(?![^\n]*--(get|list)\b)/i,
    why: 'Global git config belongs to the work account. Use "git config --local" inside this repo.',
  },
  {
    decision: DENY,
    re: /(Remove-Item|\brm\b|\brmdir\b|\bdel\b)[^\n]*data[\\/](postgres|n8n)\b/i,
    why: 'Deletes the local database / n8n data directory.',
  },
  {
    decision: DENY,
    re: /(\bcat\b|\btype\b|Get-Content|\bgc\b|\bmore\b|\bless\b|\bhead\b|\btail\b|Select-String|\bfindstr\b|\bgrep\b|\brg\b|\bsls\b)[^\n|;]*\.env(?![.\w])/i,
    why: '.env contains secrets; never print it. Read .env.example for variable names.',
  },
  {
    decision: DENY,
    re: /(\bprintenv\b|Get-ChildItem\s+env:|\bgci\s+env:|\bdir\s+env:|\bls\s+env:)/i,
    why: 'Dumping the environment can expose secrets.',
  },
  {
    decision: ASK,
    re: /\bgit\s+commit\b/i,
    why: 'Commits require explicit approval from the project owner.',
  },
  {
    decision: ASK,
    re: /\bgit\s+push\b/i,
    why: 'Pushing requires explicit approval and the personal GitHub account.',
  },
  {
    decision: ASK,
    re: /\bgh\s+(repo\s+create|pr\s+create|pr\s+merge|release\s+create|auth\s+login)\b/i,
    why: 'Creates or changes GitHub resources - confirm the personal account is active.',
  },
  {
    decision: ASK,
    re: /\b(npm|pnpm|yarn)\s+(publish|unpublish)\b/i,
    why: 'Publishing packages requires approval.',
  },
  {
    decision: ASK,
    re: /\brestore\.sh\b(?![^\n]*--verify)/i,
    why: 'restore.sh without --verify REPLACES the live production databases.',
  },
  {
    decision: ASK,
    re: /\b(deploy\.sh|harden-ssh\.sh|server-setup\.sh)\b/i,
    why: 'Changes the production server - confirm with the owner first.',
  },
];

const SECRET_FILE = /(^|[\\/])\.env(\.(?!example$)[^\\/]+)?$/i;
const MIGRATION_FILE = /(^|[\\/])migrations[\\/]\d{4}_[a-z0-9_]+\.sql$/i;
const READ_TOOLS = new Set(['view', 'read', 'read_file', 'Read']);
const EDIT_TOOLS = new Set(['edit', 'str_replace_editor', 'apply_patch', 'Edit', 'MultiEdit']);
const WRITE_TOOLS = new Set(['create', 'write', 'Write']);

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : { command: raw };
    } catch {
      return { command: raw };
    }
  }
  return {};
}

function collectPaths(args) {
  const paths = [];
  for (const key of ['path', 'file_path', 'filePath', 'target_file', 'filename']) {
    if (typeof args[key] === 'string') paths.push(args[key]);
  }
  const patch =
    typeof args.patch === 'string' ? args.patch : typeof args.input === 'string' ? args.input : '';
  for (const m of patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) paths.push(m[1].trim());
  return paths;
}

function evaluate(event) {
  const toolName = event.toolName ?? event.tool_name ?? '';
  const args = parseArgs(event.toolArgs ?? event.tool_input);

  const command = [args.command, args.cmd, args.script].find((v) => typeof v === 'string');
  if (command) {
    for (const rule of SHELL_RULES) {
      if (rule.re.test(command)) return { decision: rule.decision, reason: rule.why };
    }
  }

  const paths = collectPaths(args);
  const touchesFile = READ_TOOLS.has(toolName) || EDIT_TOOLS.has(toolName) || WRITE_TOOLS.has(toolName);
  if (touchesFile && paths.some((p) => SECRET_FILE.test(p))) {
    return {
      decision: DENY,
      reason: '.env holds secrets. Edit it yourself, or change .env.example / scripts/setup-env.mjs.',
    };
  }
  if (EDIT_TOOLS.has(toolName) && paths.some((p) => MIGRATION_FILE.test(p))) {
    return {
      decision: ASK,
      reason:
        'Editing an existing migration. Applied migrations must never change - add a new NNNN_*.sql file.',
    };
  }
  return null;
}

let out = {};
try {
  const input = readFileSync(0, 'utf8');
  const result = evaluate(input.trim() ? JSON.parse(input) : {});
  if (result)
    out = { permissionDecision: result.decision, permissionDecisionReason: `[qgm guard] ${result.reason}` };
} catch {
  out = {};
}
process.stdout.write(JSON.stringify(out));
