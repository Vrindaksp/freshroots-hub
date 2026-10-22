// Runs the dev server on the embedded database (.data/pglite) even when .env.local points at Neon,
// so you can try risky things (pausing automation, approving POs) without touching production data.
// Gemini is disabled here too, so nothing is billed. Seed it first:  npm run db:setup:local
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const port = process.env.PORT ?? "3100";

const child = spawn(process.execPath, [nextBin, "dev", "-p", port], {
  stdio: "inherit",
  // Empty strings count as "set", so Next does not fall back to the values in .env.local.
  env: { ...process.env, DATABASE_URL: "", GEMINI_API_KEY: "", KILL_SWITCH: "" },
});
child.on("exit", (code) => process.exit(code ?? 0));
