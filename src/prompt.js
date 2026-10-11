"use strict";

const readline = require("node:readline");

const LATE_INPUT_QUIET_MS = 300;
const LATE_INPUT_MAX_MS = 2000;
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
// left in the tty buffer for the shell. Input ends on Ctrl+D or two empty
// lines in a row (git output never has two), not on timing, because pastes
// over ssh arrive in delayed chunks.
function readPastedLines() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const lines = [];
  return new Promise(resolve => {
    rl.on("line", line => {
      lines.push(line);
      const [secondLast, last] = lines.slice(-2);
      if (lines.length >= 2 && !secondLast.trim() && !last.trim() && lines.some(entry => entry.trim())) rl.close();
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
      discardLateInput().then(() => resolve(lines.join("\n")));
    });
  });
}

// Swallow paste chunks still in flight so they never reach the shell: wait
// until input has been quiet for a moment, but never longer than the cap.
function discardLateInput() {
  return new Promise(resolve => {
    let quietTimer = null;
    const finish = () => {
      clearTimeout(quietTimer);
      clearTimeout(capTimer);
      process.stdin.off("data", restartQuietTimer);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    };
    const restartQuietTimer = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, LATE_INPUT_QUIET_MS);
    };
    const capTimer = setTimeout(finish, LATE_INPUT_MAX_MS);
    process.stdin.setRawMode(true);
    process.stdin.on("data", restartQuietTimer);
    process.stdin.resume();
    restartQuietTimer();
  });
}

function readPastedText(promptText) {
  if (!process.stdin.isTTY) return readAll(process.stdin);
  console.log(promptText);
  return readPastedLines();
}

module.exports = { createPrompter, readPastedText };
