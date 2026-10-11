"use strict";

const { run } = require("./run");
const { createPrompter } = require("./prompt");
const { paint } = require("./style");

function displayCommand(command, args) {
  return [command, ...args.map(arg => (/[\s"']/.test(arg) ? `"${arg}"` : arg))].join(" ");
}

async function askValue(prompter, { question, defaultValue, isValid }) {
  const answer = await prompter.ask(`    ${question}${defaultValue ? ` [${defaultValue}]` : ""}: `);
  if (answer === null) return { cancelled: true };
  const value = answer || defaultValue || "";
  if (isValid(value)) return { value };
  console.log(paint("yellow", `    "${value}" does not look right, so this step was skipped.`));
  return { value: null };
}

function runCommand(command, args, cwd) {
  const result = run(command, args, cwd);
  if (result.ok) {
    console.log(paint("green", "    ✓ Done."));
    return "fixed";
  }
  console.log(paint("red", `    ✗ That did not work: ${result.stderr || result.error?.message || `exit code ${result.status}`}`));
  return "skipped";
}

async function applyFix(prompter, check, cwd) {
  console.log(`\n  ${paint("bold", check.title)}`);
  const { autoFix } = check;
  let value = null;
  if (autoFix.question) {
    const asked = await askValue(prompter, autoFix);
    if (asked.cancelled) return "cancelled";
    if (asked.value === null) return "skipped";
    value = asked.value;
  }

  const [command, args] = autoFix.command(value);
  const answer = await prompter.ask(`    Run ${paint("cyan", displayCommand(command, args))}? [y/N] `);
  if (answer === null) return "cancelled";
  if (!/^y(es)?$/i.test(answer)) {
    console.log(paint("dim", "    Skipped."));
    return "skipped";
  }
  return runCommand(command, args, cwd);
}

async function runFixes(report, cwd) {
  const fixable = report.checks.filter(check => check.autoFix);
  if (fixable.length === 0) {
    console.log("\nNothing here can be fixed automatically. Follow the steps above.");
    return { fixed: 0, cancelled: false };
  }
  console.log(paint("bold", `\nfix-your-git can fix ${fixable.length} of these for you.`));
  console.log(paint("dim", "It shows each command and only runs it if you type y. Press Ctrl+C to stop."));

  const prompter = createPrompter();
  let fixed = 0;
  try {
    for (const check of fixable) {
      const outcome = await applyFix(prompter, check, cwd);
      if (outcome === "cancelled") return { fixed, cancelled: true };
      if (outcome === "fixed") fixed++;
    }
    return { fixed, cancelled: false };
  } finally {
    prompter.close();
  }
}

module.exports = { runFixes };
