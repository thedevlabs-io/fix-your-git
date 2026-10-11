#!/usr/bin/env node
"use strict";

const { version } = require("../package.json");
const { diagnose } = require("../src/diagnose");
const { explain, firstErrorLine } = require("../src/explain");
const { runFixes } = require("../src/fix");
const { readPastedText } = require("../src/prompt");
const { printReport, printExplanation } = require("../src/report");
const { paint } = require("../src/style");

const USAGE = `fix-your-git ${version}
Finds out why git push is not working and tells you what to run.

Usage:
  fix-your-git            Check this folder's Git and GitHub setup
  fix-your-git --fix      Check, then offer to fix the simple problems for you
  fix-your-git explain    Paste an error from git and get a plain-English fix
  fix-your-git --help     Show this help
  fix-your-git --version  Show the version

Examples:
  fix-your-git explain "fatal: Authentication failed"
  git push 2>&1 | fix-your-git explain

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
  console.error(`fix-your-git: unknown option "${input}".` +
    (suggestion ? ` Did you mean ${suggestion}?` : ""));
  console.error("Run fix-your-git --help to see what it can do.");
  process.exitCode = 2;
}

async function runExplain(args) {
  const text = args.length > 0
    ? args.join(" ")
    : await readPastedText("Paste the error from git, then press Enter until it answers (or press Ctrl+D):");
  if (!text.trim()) {
    console.error('fix-your-git: nothing to explain. Try: fix-your-git explain "the error message"');
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
  if (process.stdout.isTTY) console.log(paint("dim", "Checking your Git and GitHub setup..."));
  const report = diagnose(process.cwd());
  printReport(report);
  if (report.checks.some(check => check.status === "error")) process.exitCode = 1;
  return report;
}

async function runCheckAndFix() {
  if (!process.stdin.isTTY) {
    console.error("fix-your-git: --fix asks questions, so run it directly in a terminal (not piped).");
    process.exitCode = 2;
    return;
  }
  const report = runCheck();
  const { fixed, cancelled } = await runFixes(report, process.cwd());
  if (cancelled) {
    console.log(`\n\nCancelled. ${fixed} change(s) made; nothing else was changed.`);
    process.exitCode = 130;
    return;
  }
  if (fixed > 0) {
    console.log(paint("bold", "\nChecking again..."));
    process.exitCode = 0;
    runCheck();
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(`fix-your-git could not complete: ${error.message}`);
  process.exitCode = 1;
});
