// Gera src/prompts/bundle.ts com todos os prompts/assets como constantes string.
// Roda no prebuild/predev — garante que os .md entram no bundle serverless sem depender de fs em runtime.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "prompts");

function slug(name) {
  return name.replace(/\.(md|json)$/, "").replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function bundleDir(dir) {
  const out = {};
  for (const f of readdirSync(join(root, dir)).sort()) {
    if (!/\.(md|json)$/.test(f)) continue;
    out[slug(f)] = readFileSync(join(root, dir, f), "utf8");
  }
  return out;
}

const agents = bundleDir("agents");
const assets = bundleDir("assets");

const lines = [
  "// GERADO por scripts/bundle-prompts.mjs — não editar na mão. Fonte: src/prompts/**",
  "/* eslint-disable */",
  `export const AGENTS = ${JSON.stringify(agents)} as const;`,
  `export const ASSETS = ${JSON.stringify(assets)} as const;`,
  "",
];
writeFileSync(join(root, "bundle.ts"), lines.join("\n"));
console.log(`bundle-prompts: ${Object.keys(agents).length} agents, ${Object.keys(assets).length} assets`);
