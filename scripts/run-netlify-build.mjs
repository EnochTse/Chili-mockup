import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspaceRoot = process.cwd();
const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const sharedEnv = {
  ...process.env,
  NETLIFY: "true",
  NEXT_OUTPUT_EXPORT: "true"
};
const pathsToRestore = [
  path.resolve(workspaceRoot, "src", "app", "api"),
  path.resolve(workspaceRoot, "next-env.d.ts")
];

async function exists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function backupPath(target, backupRoot) {
  const relativePath = path.relative(workspaceRoot, target);
  const backupPath = path.resolve(backupRoot, relativePath);
  const targetExists = await exists(target);

  if (!targetExists) {
    return {
      backupPath,
      target,
      targetExists
    };
  }

  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.cp(target, backupPath, { recursive: true });

  return {
    backupPath,
    target,
    targetExists
  };
}

async function restorePath({ backupPath, target, targetExists }) {
  await fs.rm(target, { recursive: true, force: true });

  if (!targetExists) {
    return;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(backupPath, target, { recursive: true });
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: sharedEnv
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Script failed with exit code ${code ?? 1}: ${scriptPath}`));
    });
  });
}

function runNextBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, "build", "--webpack"], {
      stdio: "inherit",
      env: sharedEnv
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Next build failed with exit code ${code ?? 1}.`));
    });
  });
}

const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chili-netlify-build-"));
const backups = await Promise.all(pathsToRestore.map((target) => backupPath(target, backupRoot)));

try {
  await runNodeScript(path.resolve(workspaceRoot, "scripts", "prepare-netlify-build.mjs"));
  await runNextBuild();
  await runNodeScript(path.resolve(workspaceRoot, "scripts", "verify-netlify-build.mjs"));
} finally {
  for (const entry of backups) {
    await restorePath(entry);
  }

  await fs.rm(backupRoot, { recursive: true, force: true });
}
