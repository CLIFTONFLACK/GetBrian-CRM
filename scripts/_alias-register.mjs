// Entry point for `node --import ./scripts/_alias-register.mjs <script>`.
// See _alias-hooks.mjs for what this actually does.
import { register } from "node:module";

register("./_alias-hooks.mjs", import.meta.url);
