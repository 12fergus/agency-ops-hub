// PostToolUse(Write|Edit): format the edited file with the PROJECT's own
// formatter, only if it is installed locally. Never downloads anything.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readInput } = require('./lib');

const input = readInput();
const file = (input.tool_input || {}).file_path || (input.tool_response || {}).filePath;
if (!file || !fs.existsSync(file)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const q = (s) => `"${s}"`;
const run = (cmd) => spawnSync(cmd, { cwd: root, shell: true, stdio: 'ignore', timeout: 50000 });

const ext = path.extname(file).toLowerCase();
const PRETTIER_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.html', '.vue', '.md', '.yml', '.yaml'];

if (PRETTIER_EXT.includes(ext) && fs.existsSync(path.join(root, 'node_modules', 'prettier'))) {
  run(`npx --no-install prettier --write --ignore-unknown ${q(file)}`);
} else if (ext === '.php' && fs.existsSync(path.join(root, 'vendor', 'bin', 'php-cs-fixer'))) {
  run(`php ${q(path.join(root, 'vendor', 'bin', 'php-cs-fixer'))} fix --quiet ${q(file)}`);
}
process.exit(0);
