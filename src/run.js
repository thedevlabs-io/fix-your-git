"use strict";

const { spawnSync } = require("node:child_process");

function run(command, args, cwd, timeout = 10000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout,
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error || null
  };
}

function commandExists(command, cwd) {
  const result = process.platform === "win32"
    ? run("where", [command], cwd)
    : run("which", [command], cwd);
  return result.ok;
}

module.exports = { run, commandExists };
