import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

const LIGHT = /:root,\s*\[data-theme='light'\]\s*\{[^}]*\}/;
const DARK_MEDIA = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{[^}]*\}\s*\}/;
const DARK_FORCED = /\[data-theme='dark'\]\s*\{[^}]*\}/;

/** The custom-property declarations inside the first block matching `block`. */
function tokens(block: RegExp): string[] {
  const match = css.match(block);
  if (!match) throw new Error(`block not found: ${block}`);
  const upToClose = match[0].slice(0, match[0].indexOf('}'));
  const body = upToClose.slice(upToClose.lastIndexOf('{') + 1);
  return body
    .split(';')
    .map((line) => line.replace(/\/\*.*?\*\//g, '').replace(/[{}]/g, '').trim())
    .filter((line) => line.startsWith('--'));
}

describe('theme tokens', () => {
  it('keeps the two dark-mode blocks identical', () => {
    const media = tokens(DARK_MEDIA);
    const forced = tokens(DARK_FORCED);
    expect(media.length).toBeGreaterThan(10);
    expect(media).toEqual(forced);
  });

  it('gives every light colour token a dark value', () => {
    const name = (line: string) => line.split(':')[0];
    const dark = new Set(tokens(DARK_FORCED).map(name));
    // Tokens defined from another token (var(--x)) follow it into dark mode on their own.
    const missing = tokens(LIGHT)
      .filter((line) => !/:\s*var\(--/.test(line))
      .map(name)
      .filter((token) => !dark.has(token));
    expect(missing).toEqual([]);
  });

  it('has no raw colours outside the token blocks', () => {
    const outside = css.replace(LIGHT, '').replace(DARK_MEDIA, '').replace(DARK_FORCED, '');
    expect(outside.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)).toBeNull();
  });
});
