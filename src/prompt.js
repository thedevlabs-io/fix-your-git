"use strict";

const readline = require("node:readline");

const PASTE_IDLE_MS = 400;

function createPrompter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const typedAhead = [];
  let pending = null;
  let closed = false;

  const settle = value => {
    const resolve = pending;
    pending = null;
    if (resolve) resolve(value);
  };
  rl.on("line", line => (pending ? settle(line.trim()) : typedAhead.push(line.trim())));
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

function readPastedBurst() {
  const rl = readline.createInterface({ input: process.stdin });
  const lines = [];
  let idleTimer = null;
  return new Promise(resolve => {
    rl.on("line", line => {
      lines.push(line);
      if (!lines.some(entry => entry.trim())) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => rl.close(), PASTE_IDLE_MS);
    });
    rl.on("SIGINT", () => rl.close());
    rl.on("close", () => {
      clearTimeout(idleTimer);
      resolve(lines.join("\n"));
    });
  });
}

function readPastedText(promptText) {
  if (!process.stdin.isTTY) return readAll(process.stdin);
  console.log(promptText);
  return readPastedBurst();
}

module.exports = { createPrompter, readPastedText };
