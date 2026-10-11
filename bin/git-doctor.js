#!/usr/bin/env node
"use strict";

const { version } = require("../package.json");
const { diagnose } = require("../src/diagnose");
const { printReport } = require("../src/report");

const USAGE = `git-doctor ${version}
Finds out why git push is not working and tells you what to run.

Usage:
  git-doctor            Check this folder's Git and GitHub setup
  git-doctor --help     Show this help
  git-doctor --version  Show the version

Run it from inside your project folder. It only reads your setup; it
never changes files or settings.`;

const OPTIONS = ["--help", "--version"];

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
    .map(option => ({ option, distance: editDistance(input.replace(/^-*/, "--"), option) }))
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

function main(args) {
  const [first] = args;
  if (first === "--help" || first === "-h" || first === "help") {
    console.log(USAGE);
    return;
  }
  if (first === "--version" || first === "-v") {
    console.log(version);
    return;
  }
  if (first !== undefined) {
    failUnknown(first);
    return;
  }

  const report = diagnose(process.cwd());
  printReport(report);
  if (report.checks.some(check => check.status === "error")) process.exitCode = 1;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`git-doctor could not complete: ${error.message}`);
  process.exitCode = 1;
}
