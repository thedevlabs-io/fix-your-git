#!/usr/bin/env node
"use strict";

const { diagnose } = require("../src/diagnose");

function printReport(report) {
  console.log("\ngit-doctor");
  console.log("==========\n");

  for (const check of report.checks) {
    const symbol = check.status === "ok" ? "✓"
      : check.status === "warn" ? "!" : "✗";
    console.log(`${symbol} ${check.title}`);
    console.log(`  ${check.message}`);
    if (check.fix) {
      console.log(`  Suggested next step: ${check.fix}`);
    }
    console.log("");
  }

  console.log("Summary");
  console.log("-------");
  console.log(`${report.checks.filter(c => c.status === "ok").length} passed, ` +
    `${report.checks.filter(c => c.status === "warn").length} warning(s), ` +
    `${report.checks.filter(c => c.status === "error").length} error(s)`);

  console.log("\nNo repository settings or files were changed.");
  console.log("Note: local checks cannot guarantee that GitHub will accept a push.");
}

try {
  printReport(diagnose(process.cwd()));
} catch (error) {
  console.error(`git-doctor could not complete: ${error.message}`);
  process.exitCode = 1;
}
