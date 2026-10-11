"use strict";

const readline = require("node:readline");

const PASTE_QUIET_MS = 100;
const STALE_INPUT_MS = 100;

function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const typedAhead = [];
  const createdAt = Date.now();
  let pending = null;
  let closed = false;

  const settle = value => {
    const resolve = pending;
    pending = null;
    if (resolve) resolve(value);
  };
  rl.on("line", line => {
    // Keys pressed while the slow check ran arrive at once; they must not
    // answer (or confirm) a question the user has not seen yet.
    if (Date.now() - createdAt < STALE_INPUT_MS) return;
    if (pending) settle(line.trim());
    else typedAhead.push(line.trim());
  });
  rl.on("SIGINT", () => rl.close());
  rl.on("close", () => {
    closed = true;
    settle(null);
  });

  return {
    ask(question) {
      if (closed) return Promise.resolve(null);
      rl.setPrompt(question);
      rl.prompt();
      if (typedAhead.length > 0) return Promise.resolve(typedAhead.shift());
      return new Promise(resolve => { pending = resolve; });
    },
    close() {
      rl.close();
    }
  };
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", chunk => { text += chunk; });
    stream.on("end", () => resolve(text));
    stream.on("error", reject);
  });
}

// Terminal mode keeps unfinished lines inside readline, so nothing pasted is
// left in the tty buffer for the shell to run after we exit. A blank line
// ends input only when typed after the paste went quiet, because git errors
// contain blank lines of their own.
function readPastedLines() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = [];
  let lastLineAt = 0;
  return new Promise(resolve => {
    rl.on("line", line => {
      const now = Date.now();
      const quiet = now - lastLineAt > PASTE_QUIET_MS;
      lastLineAt = now;
      if (line.trim() === "" && quiet && lines.some(entry => entry.trim())) {
        rl.close();
        return;
      }
      lines.push(line);
    });
    const finishOnCtrlD = (_, key) => {
      if (!key || !key.ctrl || key.name !== "d") return;
      if (rl.line) lines.push(rl.line);
      rl.close();
    };
    process.stdin.on("keypress", finishOnCtrlD);
    rl.on("SIGINT", () => {
      lines.length = 0;
      rl.close();
    });
    rl.on("close", () => {
      process.stdin.off("keypress", finishOnCtrlD);
      resolve(lines.join("\n"));
    });
  });
}

function readPastedText(promptText) {
  if (!process.stdin.isTTY) return readAll(process.stdin);
  console.log(promptText);
  return readPastedLines();
}

module.exports = { createPrompter, readPastedText };
