"use strict";

const { paint } = require("./style");

const SYMBOLS = { ok: "✓", warn: "!", error: "✗" };
const COLORS = { ok: "green", warn: "yellow", error: "red" };

function printChecks(checks) {
  for (const check of checks) {
    const symbol = paint(COLORS[check.status], SYMBOLS[check.status]);
    console.log(`  ${symbol} ${check.title}`);
    const message = check.status === "ok" ? paint("dim", check.message) : check.message;
    console.log(`    ${message}`);
  }
}

function printFix({ hint, commands, commandsLabel = "Run:" }) {
  if (hint) console.log(`     ${hint}`);
  if (commands && commands.length > 0) {
    console.log(paint("dim", `     ${commandsLabel}`));
    for (const command of commands) {
      console.log(`       ${paint("cyan", command)}`);
    }
  }
}

function printStep(check, number) {
  const label = check.autoFix ? paint("dim", " (fix-your-git --fix can do this)") : "";
  console.log(`  ${paint("bold", `${number}. ${check.title}`)}${label}`);
  printFix(check);
  if (check.alternative) printFix(check.alternative);
  console.log("");
}

function printNextSteps(problems) {
  console.log(paint("bold", "\nWhat to do next"));
  console.log(paint("dim", "Work through these in order. Many later steps depend on earlier ones.\n"));
  problems.forEach((check, index) => printStep(check, index + 1));
  console.log("Run fix-your-git again after each step to see what is left.");
  console.log(`Got an error from git push? Run ${paint("cyan", "fix-your-git explain")} and paste it.`);
}

function printSummary(checks) {
  const count = status => checks.filter(c => c.status === status).length;
  console.log(paint("dim",
    `\n${count("ok")} passed, ${count("warn")} warning(s), ${count("error")} error(s). ` +
    "This check did not change anything."));
  console.log(paint("dim", "Local checks cannot guarantee that GitHub will accept a push."));
}

function printReport(report) {
  console.log(`\n${paint("bold", "fix-your-git")} ${paint("dim", `checking ${report.cwd}`)}\n`);
  printChecks(report.checks);

  const problems = report.checks.filter(c => c.status !== "ok");
  if (problems.length > 0) {
    printNextSteps(problems);
  } else {
    console.log(paint("green", "\nEverything looks ready. You should be able to run git push."));
  }
  printSummary(report.checks);
}

function printExplanation(result, firstErrorLine) {
  if (!result) {
    console.log(`\n${paint("yellow", "!")} fix-your-git does not recognise this error yet.`);
    if (firstErrorLine) console.log(`  Search the web for this line: ${paint("cyan", firstErrorLine.trim())}`);
    console.log("  For a full check of your setup, run fix-your-git inside your project folder.");
    return;
  }
  console.log(`\n${paint("bold", result.title)}`);
  console.log(`  ${result.cause}\n`);
  console.log(paint("bold", "What to do"));
  printFix(result);
}

module.exports = { printReport, printExplanation };
