#!/usr/bin/env node
"use strict";

const { version } = require("../package.json");
const { diagnose } = require("../src/diagnose");
const { explain, firstErrorLine } = require("../src/explain");
const { runFixes } = require("../src/fix");
const { readPastedText } = require("../src/prompt");
const { printReport, printExplanation } = require("../src/report");
const { paint } = require("../src/style");

const USAGE = `git-doctor ${version}
Finds out why git push is not working and tells you what to run.

Usage:
  git-doctor            Check this folder's Git and GitHub setup
  git-doctor --fix      Check, then offer to fix the simple problems for you
  git-doctor explain    Paste an error from git and get a plain-English fix
  git-doctor --help     Show this help
  git-doctor --version  Show the version

Examples:
  git-doctor explain "fatal: Authentication failed"
  git push 2>&1 | git-doctor explain

Run it from inside your project folder. It only reads your setup unless
you use --fix, which asks before every change.`;

const OPTIONS = ["--help", "--version", "--fix", "explain"];

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function closestOption(input) {
  const ranked = OPTIONS
    .map(option => ({
      option,
      distance: editDistance(option.startsWith("--") ? input.replace(/^-*/, "--") : input, option)
    }))
    .sort((a, b) => a.distance - b.distance);
  return ranked[0].distance <= 2 ? ranked[0].option : "";
}

function failUnknown(input) {
  const suggestion = closestOption(input);
  console.error(`git-doctor: unknown option "${input}".` +
    (suggestion ? ` Did you mean ${suggestion}?` : ""));
  console.error("Run git-doctor --help to see what it can do.");
  process.exitCode = 2;
}

async function runExplain(args) {
  const text = args.length > 0
    ? args.join(" ")
    : await readPastedText("Paste the error from git, then press Enter on an empty line:");
  if (!text.trim()) {
    console.error('git-doctor: nothing to explain. Try: git-doctor explain "the error message"');
    process.exitCode = 2;
    return;
  }
  printExplanation(explain(text), firstErrorLine(text));
}

async function main(args) {
  const [first, ...rest] = args;
  if (first === "--help" || first === "-h" || first === "help") {
    console.log(USAGE);
    return;
  }
  if (first === "--version" || first === "-v") {
    console.log(version);
    return;
  }
  if (first === "explain") {
    await runExplain(rest);
    return;
  }
  if (first === "--fix") {
    await runCheckAndFix();
    return;
  }
  if (first !== undefined) {
    failUnknown(first);
    return;
  }
  runCheck();
}

function runCheck() {
  const report = diagnose(process.cwd());
  printReport(report);
  if (report.checks.some(check => check.status === "error")) process.exitCode = 1;
  return report;
}

async function runCheckAndFix() {
  if (!process.stdin.isTTY) {
    console.error("git-doctor: --fix asks questions, so run it directly in a terminal (not piped).");
    process.exitCode = 2;
    return;
  }
  const report = runCheck();
  const fixed = await runFixes(report, process.cwd());
  if (fixed > 0) {
    console.log(paint("bold", "\nChecking again..."));
    process.exitCode = 0;
    runCheck();
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(`git-doctor could not complete: ${error.message}`);
  process.exitCode = 1;
});
