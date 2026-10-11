"use strict";

const CODES = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39]
};

function colorEnabled() {
  if (process.env.FORCE_COLOR) return process.env.FORCE_COLOR !== "0";
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb";
}

const enabled = colorEnabled();

function paint(style, text) {
  if (!enabled) return text;
  const [open, close] = CODES[style];
  return `\u001b[${open}m${text}\u001b[${close}m`;
}

module.exports = { paint };
