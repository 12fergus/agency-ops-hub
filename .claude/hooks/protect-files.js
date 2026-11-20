// PreToolUse(Write|Edit): block writes to secrets, keys and lockfiles.
const path = require('path');
const { readInput, decide } = require('./lib');

const file = ((readInput().tool_input || {}).file_path || '').replace(/\\/g, '/');
const base = path.posix.basename(file);

if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
  decide('deny', `${base} holds secrets. Edit .env.example instead and tell the user which variables to set.`);
}
if (/\.(pem|key|p12|pfx)$/i.test(base) || /\/secrets\//.test(file)) {
  decide('deny', 'Key/secret files must not be written by Claude.');
}
if (/^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|composer\.lock)$/.test(base)) {
  decide('deny', `${base} is generated. Change the manifest and run the package manager instead.`);
}
process.exit(0);
