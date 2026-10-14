import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const buildDirectory = resolve("dist/public");
const deploymentDirectory = resolve("public");

if (!existsSync(resolve(buildDirectory, "index.html"))) {
  throw new Error("Vite build output is missing dist/public/index.html.");
}

rmSync(deploymentDirectory, { recursive: true, force: true });
mkdirSync(deploymentDirectory, { recursive: true });
cpSync(buildDirectory, deploymentDirectory, { recursive: true });
console.log("Prepared Vercel public assets from dist/public.");
