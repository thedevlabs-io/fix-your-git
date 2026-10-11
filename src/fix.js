"use strict";

const { run } = require("./run");
const { ask } = require("./prompt");
const { paint } = require("./style");

function displayCommand(command, args) {
  return [command, ...args.map(arg => (/[\s"']/.test(arg) ? `"${arg}"` : arg))].join(" ");
}

async function askValue({ question, defaultValue, isValid }) {
  const answer = await ask(`    ${question}${defaultValue ? ` [${defaultValue}]` : ""}: `);
  const value = answer || defaultValue || "";
  if (isValid(value)) return value;
  console.log(paint("yellow", `    "${value}" does not look right, so this step was skipped.`));
  return null;
}

async function applyFix(check, cwd) {
  console.log(`\n  ${paint("bold", check.title)}`);
  const { autoFix } = check;
  const value = autoFix.question ? await askValue(autoFix) : null;
  if (autoFix.question && value === null) return false;

  const [command, args] = autoFix.command(value);
  const answer = await ask(`    Run ${paint("cyan", displayCommand(command, args))}? [y/N] `);
  if (!/^y(es)?$/i.test(answer)) {
    console.log(paint("dim", "    Skipped."));
    return false;
  }

  const result = run(command, args, cwd);
  if (result.ok) {
    console.log(paint("green", "    ✓ Done."));
    return true;
  }
  console.log(paint("red", `    ✗ That did not work: ${result.stderr || result.error?.message || `exit code ${result.status}`}`));
  return false;
}

async function runFixes(report, cwd) {
  const fixable = report.checks.filter(check => check.autoFix);
  if (fixable.length === 0) {
    console.log("\nNothing here can be fixed automatically. Follow the steps above.");
    return 0;
  }
  console.log(paint("bold", `\nfix-your-git can fix ${fixable.length} of these for you.`));
  console.log(paint("dim", "It shows each command and only runs it if you type y."));

  let fixed = 0;
  for (const check of fixable) {
    if (await applyFix(check, cwd)) fixed++;
  }
  return fixed;
}

module.exports = { runFixes };
