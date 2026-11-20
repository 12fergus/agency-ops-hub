// PreToolUse(Bash): force a confirmation prompt for destructive commands,
// even in auto/acceptEdits modes. Explain impact + rollback before approving.
const { readInput, decide } = require('./lib');

const cmd = (readInput().tool_input || {}).command || '';

const RISKY = [
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, 'recursive force delete'],
  [/\bgit\s+push\b.*(--force\b|-f\b|--force-with-lease)/, 'force push'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
  [/\bgit\s+clean\s+-[a-z]*f/i, 'git clean (deletes untracked files)'],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, 'discarding all working-tree changes'],
  [/\b(drop|truncate)\s+(database|schema|table)\b/i, 'SQL DROP/TRUNCATE'],
  [/\bdelete\s+from\s+\w+\s*;?\s*$/i, 'DELETE without WHERE'],
  [/\bartisan\s+(migrate(:fresh|:reset|:rollback|:refresh)?|db:wipe|db:seed)\b/, 'Laravel migration/seed'],
  [/\b(prisma\s+migrate\s+reset|prisma\s+db\s+push)\b/, 'Prisma schema reset/push'],
  [/\b(npm|pnpm|yarn)\s+publish\b/, 'package publish'],
];

for (const [re, label] of RISKY) {
  if (re.test(cmd)) {
    decide('ask', `Destructive command detected (${label}). State the impact and the rollback plan before running it.`);
  }
}
process.exit(0);
