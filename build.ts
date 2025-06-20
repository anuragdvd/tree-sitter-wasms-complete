import fs from "fs";
import os from "os";
import path from "path";
import util from "util";

import { PromisePool } from "@supercharge/promise-pool";
const findRoot = require("find-root");

import packageInfo from "./package.json";

const langArg = process.argv[2];

const exec = util.promisify(require("child_process").exec);

const outDir = path.join(__dirname, "out");

let hasErrors = false;

async function buildParserWASM(
  name: string,
  { subPath, generate }: { subPath?: string; generate?: boolean } = {}
) {
  const label = subPath ? path.join(name, subPath) : name;
  try {
    console.log(`⏳ Building ${label}`);
    let packagePath;
    try {
      packagePath = findRoot(require.resolve(name));
    } catch (_) {
      packagePath = path.join(__dirname, "node_modules", name);
    }
    const cwd = subPath ? path.join(packagePath, subPath) : packagePath;
    if (generate) {
      await exec(`pnpm tree-sitter generate`, { cwd });
    }
    await exec(`pnpm tree-sitter build-wasm ${cwd}`);
    console.log(`✅ Finished building ${label}`);
  } catch (e) {
    console.error(`🔥 Failed to build ${label}:\n`, e);
    hasErrors = true;
  }
}

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}

fs.mkdirSync(outDir);

process.chdir(outDir);

const grammars = Object.keys(packageInfo.devDependencies)
  .filter((n) => n.startsWith("tree-sitter-") && n !== "tree-sitter-cli")
  .concat('@tree-sitter-grammars/tree-sitter-zig')
  .concat("@tlaplus/tree-sitter-tlaplus")
  .filter((s) => !langArg || s.includes(langArg));

PromisePool.withConcurrency(os.cpus().length)
  .for(grammars)
  .process(async (name) => {
    if (name == "tree-sitter-rescript") {
      await buildParserWASM(name, { generate: true });
    } else if (name == "tree-sitter-ocaml") {
      await buildParserWASM(name, { subPath: "ocaml" });
    } else if (name == "tree-sitter-php") {
      await buildParserWASM(name, { subPath: "php" });
    } else if (name == "tree-sitter-typescript") {
      await buildParserWASM(name, { subPath: "typescript" });
      await buildParserWASM(name, { subPath: "tsx" });
    } else {
      await buildParserWASM(name);
    }
  })
  .then(async () => {
    // Build local tree-sitter-haskell
    if (fs.existsSync(path.join(__dirname, "tree-sitter-haskell"))) {
      try {
        console.log(`⏳ Building tree-sitter-haskell (local)`);
        await exec(`pnpm tree-sitter build-wasm ${path.join(__dirname, "tree-sitter-haskell")}`);
        console.log(`✅ Finished building tree-sitter-haskell (local)`);
      } catch (e) {
        console.error(`🔥 Failed to build tree-sitter-haskell:\n`, e);
        hasErrors = true;
      }
    }

    // Copy existing tree-sitter-purescript.wasm
    if (fs.existsSync(path.join(__dirname, "tree-sitter-purescript.wasm"))) {
      fs.copyFileSync(
        path.join(__dirname, "tree-sitter-purescript.wasm"),
        path.join(outDir, "tree-sitter-purescript.wasm")
      );
      console.log(`✅ Copied tree-sitter-purescript.wasm`);
    }

    if (hasErrors) {
      process.exit(1);
    }
    await exec(`mv *.wasm ${outDir}`, { cwd: __dirname });
  });
