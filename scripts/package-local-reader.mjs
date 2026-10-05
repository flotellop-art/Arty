import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const source = fileURLToPath(new URL('../local-reader/', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node scripts/package-local-reader.mjs <output.zip>');
const output = resolve(process.argv[2]);
if (!output.toLowerCase().endsWith('.zip')) throw new Error('Output must end with .zip');
// Exact allowlist: never include workspace config, captures or credentials.
const names = ['manifest.json', 'extract.mjs', 'reader.mjs', 'popup.html', 'popup.css', 'popup.mjs', 'README.md'];
const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, new Uint8Array(await readFile(resolve(source, name)))])));
await mkdir(dirname(output), { recursive: true });
await writeFile(output, zipSync(files, { level: 9 }));
console.log(output);
