// Node module-resolution hook: lets maintainer scripts in scripts/ (which run
// via plain `node`, not Next.js's bundler) import the app's own modules — e.g.
// the DAO layer in src/lib/db/queries/ or the matcher in src/lib/matching/ —
// instead of duplicating their logic by hand. Registered by
// _alias-register.mjs via `node --import ./scripts/_alias-register.mjs <script>`.
//
// It closes the three gaps between Next's resolver and Node's:
//
//   1. "@/..." specifiers            -> the real path under src/
//   2. extensionless / directory     -> "foo.ts", then "foo/index.ts"
//   3. bare .json imports            -> Node demands `with { type: "json" }`,
//                                       Next does not, so the app's modules
//                                       import JSON bare and Node refuses them
//
// Without (2) and (3), importing anything that reaches @/lib/locations (the
// matcher, the geocoder, the importer) failed outright — the directory has an
// index.ts and that index imports two JSON datasets.
//
// Everything else passes through untouched.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = pathToFileURL(join(__dirname, "..", "src") + "/").href;

/** First of `foo`, `foo.ts`, `foo/index.ts` that exists on disk. */
function resolveFile(url) {
  const candidates = /\.[a-zA-Z0-9]+$/.test(url.pathname)
    ? [url]
    : [new URL(url.href + ".ts"), new URL(url.href + "/index.ts")];
  for (const candidate of candidates) {
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  // A directory specifier that does carry an extension-looking segment, or a
  // miss: hand the original back so Node reports its own error.
  const asIndex = new URL(url.href.replace(/\/?$/, "/index.ts"));
  return existsSync(fileURLToPath(asIndex)) ? asIndex : url;
}

const JSON_ATTRS = { type: "json" };

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = resolveFile(new URL(specifier.slice(2), SRC_DIR));
    return nextResolve(target.href, context);
  }
  // Node refuses a .json import without an explicit attribute. Supply it on
  // the script's behalf rather than editing the app's modules to suit Node.
  if (specifier.endsWith(".json")) {
    const resolved = await nextResolve(specifier, {
      ...context,
      importAttributes: JSON_ATTRS,
    });
    return { ...resolved, format: "json", importAttributes: JSON_ATTRS };
  }
  return nextResolve(specifier, context);
}
