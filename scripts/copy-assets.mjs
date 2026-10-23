// Copy non-TypeScript runtime assets (SQL migrations) into dist/ after tsc.
import { cpSync, mkdirSync } from 'fs';
mkdirSync('dist/db/migrations', { recursive: true });
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
console.log('Copied SQL migrations to dist/db/migrations');
