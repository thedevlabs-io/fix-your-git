"use strict";

const readline = require("node:readline");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

function readUntilBlankLine() {
  const rl = readline.createInterface({ input: process.stdin });
  const lines = [];
  return new Promise(resolve => {
    rl.on("line", line => {
      if (line.trim() === "" && lines.length > 0) {
        rl.close();
        return;
      }
      if (line.trim() !== "") lines.push(line);
    });
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

function readPastedText(promptText) {
  if (!process.stdin.isTTY) return readAll(process.stdin);
  console.log(promptText);
  return readUntilBlankLine();
}

module.exports = { ask, readPastedText };
