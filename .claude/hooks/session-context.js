// SessionStart: inject current git branch, dirty files and recent commits.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!fs.existsSync(path.join(root, '.git'))) process.exit(0);

const sh = (c) => {
  try {
    return execSync(c, { cwd: root, encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
};

const ctx = [
  'Git status:',
  sh('git status -sb') || '(clean)',
  '',
  'Recent commits:',
  sh('git log --oneline -5') || '(none)',
].join('\n');

process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } }),
);
