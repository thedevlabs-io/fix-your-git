#!/usr/bin/env node
"use strict";

const { diagnose } = require("../src/diagnose");
const { printReport } = require("../src/report");

try {
  printReport(diagnose(process.cwd()));
} catch (error) {
  console.error(`git-doctor could not complete: ${error.message}`);
  process.exitCode = 1;
}
