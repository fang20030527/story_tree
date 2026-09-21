#!/usr/bin/env node
/**
 * CLI: node tools/url-extract/extract.mjs <url> [--out DIR] [--download-images]
 */
import { extractToFiles } from './lib.mjs';

function usage() {
  console.error(`Usage: node tools/url-extract/extract.mjs <url> [--out DIR] [--download-images]

Extracts readable article text and images (Readability, same idea as app import).
Writes article.txt, meta.json, and optionally images/ under --out.`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { url: null, out: null, downloadImages: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--download-images') args.downloadImages = true;
    else if (a === '--help' || a === '-h') usage();
    else if (!args.url && !a.startsWith('-')) args.url = a;
    else usage();
  }
  if (!args.url) usage();
  return args;
}

const args = parseArgs(process.argv.slice(2));
const { outRoot, meta, text } = await extractToFiles(args.url, {
  outDir: args.out,
  downloadImages: args.downloadImages,
});
console.log(
  JSON.stringify(
    { out: outRoot, ...meta, textPreview: text.slice(0, 240) },
    null,
    2,
  ),
);
