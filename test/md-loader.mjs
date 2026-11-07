// worker.js pulls in pages.js, which imports docs/SDK.md as a plain string (Wrangler's Text rule
// for *.md in wrangler.jsonc). Plain `node --test` doesn't know that rule, so give it the same
// behaviour here: a .md import's default export is the file's raw text.
import { readFile } from 'node:fs/promises';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.md')) {
    const source = await readFile(new URL(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(source)};` };
  }
  return nextLoad(url, context);
}
