import { cp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const docs = new URL("docs/", root);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

await run(process.execPath, ["scripts/build.mjs"], {
  env: {
    ...process.env,
    BASE_PATH: process.env.BASE_PATH || "",
    PUBLIC_URL: process.env.PUBLIC_URL || "https://theatremaniac.com",
  },
});

await rm(docs, { recursive: true, force: true });
await cp(dist, docs, { recursive: true });
await writeFile(new URL(".nojekyll", docs), "");
await writeFile(new URL("CNAME", docs), "theatremaniac.com\n");

console.log("Generated production docs/ for GitHub Pages.");
