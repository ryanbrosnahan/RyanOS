#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const force = process.argv.includes("--force");
const explicitTarget = process.argv.find((arg) => arg.startsWith("--path="))?.slice("--path=".length);
const target = resolve(explicitTarget || process.env.RYANOS_MASTER_KEY_FILE || "secrets/master-key");

await mkdir(dirname(target), { recursive: true, mode: 0o700 });

try {
  await writeFile(target, `${randomBytes(32).toString("base64url")}\n`, {
    encoding: "utf8",
    flag: force ? "w" : "wx",
    mode: 0o600
  });
  await chmod(target, 0o600);
  console.log(`Wrote RyanOS master key to ${target}`);
} catch (err) {
  if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
    console.error(`${target} already exists. Re-run with --force only if you are intentionally rotating the local dev key.`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
