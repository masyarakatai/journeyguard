// Copies non-TypeScript assets (dashboard CSS) next to the compiled code.
import { cpSync, chmodSync } from 'node:fs';

cpSync('src/dashboard', 'dist/src/dashboard', { recursive: true });
chmodSync('dist/src/bin.js', 0o755);
