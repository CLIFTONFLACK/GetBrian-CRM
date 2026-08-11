// Node module-resolution hook: rewrites "@/..." specifiers to their real
// path under src/, so maintainer scripts in scripts/ (which run via plain
// `node`, not Next.js's bundler) can import the app's own "@/lib/..."
// modules — e.g. the DAO layer in src/lib/db/queries/ — instead of
// duplicating their SQL by hand. Registered by _alias-register.mjs via
// `node --import ./scripts/_alias-register.mjs <script>`. Touches nothing
// outside this one resolve step; every other specifier passes through
// untouched.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = pathToFileURL(join(__dirname, "..", "src") + "/").href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    let rel = specifier.slice(2);
    if (!/\.[a-zA-Z0-9]+$/.test(rel)) rel += ".ts";
    return nextResolve(new URL(rel, SRC_DIR).href, context);
  }
  return nextResolve(specifier, context);
}
