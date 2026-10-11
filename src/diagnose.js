"use strict";

const { spawnSync } = require("node:child_process");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    error: result.error || null
  };
}

function commandExists(command, cwd) {
  const result = process.platform === "win32"
    ? run("where", [command], cwd)
    : run("which", [command], cwd);
  return result.ok;
}

function safeRemoteUrl(value) {
  if (!value) return "";
  // Avoid printing credentials embedded in HTTPS URLs.
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }
    return parsed.toString();
  } catch {
    // SSH/scp-style URLs do not parse as standard URLs and normally contain no password.
    return value.replace(/(https?:\/\/)[^/@\s]+@/i, "$1[redacted]@");
  }
}

function diagnose(cwd = process.cwd()) {
  const checks = [];
  const add = (status, title, message, fix = "") =>
    checks.push({ status, title, message, ...(fix ? { fix } : {}) });

  const gitVersion = run("git", ["--version"], cwd);
  if (!gitVersion.ok) {
    add("error", "Git is available",
      "Git was not found or could not be started.",
      "Install Git from https://git-scm.com/downloads, then reopen your terminal.");
    return { cwd, checks };
  }
  add("ok", "Git is available", gitVersion.stdout);

  const repo = run("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  if (!repo.ok || repo.stdout !== "true") {
    add("error", "Current folder belongs to a Git repository",
      "This folder is not inside a Git working tree.",
      "Use cd to enter your project folder. If this is a new project, run git init here.");
    return { cwd, checks };
  }
  const rootResult = run("git", ["rev-parse", "--show-toplevel"], cwd);
  add("ok", "Git repository detected",
    `Repository root: ${rootResult.stdout || "(could not determine root)"}`);

  const branchResult = run("git", ["branch", "--show-current"], cwd);
  const branch = branchResult.stdout;
  if (!branch) {
    add("warn", "Current branch",
      "Git did not report a branch name; you may be in a detached HEAD state.",
      "Run git status and switch to or create the branch you intend to push.");
  } else {
    add("ok", "Current branch", branch);
  }

  const name = run("git", ["config", "--get", "user.name"], cwd);
  const email = run("git", ["config", "--get", "user.email"], cwd);
  if (!name.ok || !name.stdout) {
    add("warn", "Commit author name",
      "Git user.name is not configured.",
      'Run git config --global user.name "Your Name".');
  } else {
    add("ok", "Commit author name", "Configured.");
  }
  if (!email.ok || !email.stdout) {
    add("warn", "Commit author email",
      "Git user.email is not configured.",
      'Run git config --global user.email "you@example.com".');
  } else {
    add("ok", "Commit author email", "Configured.");
  }

  const remotesResult = run("git", ["remote"], cwd);
  const remotes = remotesResult.ok && remotesResult.stdout
    ? remotesResult.stdout.split(/\r?\n/).filter(Boolean)
    : [];

  if (remotes.length === 0) {
    add("error", "Remote repository",
      "No Git remote is configured, so Git does not know where to push.",
      "Create a repository on GitHub, then run git remote add origin https://github.com/USERNAME/REPOSITORY.git (replace the placeholder URL).");
  } else {
    const remote = remotes.includes("origin") ? "origin" : remotes[0];
    const urlResult = run("git", ["remote", "get-url", remote], cwd);
    const remoteUrl = urlResult.stdout;
    const isGitHub = /(^|[/:@])github\.com([/:]|$)/i.test(remoteUrl);
    add(isGitHub ? "ok" : "warn", "Remote repository",
      `${remote} is configured${isGitHub ? " for GitHub" : ", but its URL does not look like a GitHub URL"}.` +
      (remoteUrl ? ` URL: ${safeRemoteUrl(remoteUrl)}` : ""),
      isGitHub ? "" : "Check the remote URL with git remote -v. To correct it, use git remote set-url origin YOUR_REPOSITORY_URL.");

    const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
    if (!upstream.ok) {
      if (branch && remotes.includes("origin")) {
        add("warn", "Branch tracking",
          `Branch "${branch}" does not appear to track a remote branch.`,
          `After confirming the branch and remote are correct, run git push -u origin ${branch}.`);
      } else {
        add("warn", "Branch tracking",
          "An upstream branch could not be detected.",
          "Check the branch and remote, then set the upstream with git push -u REMOTE BRANCH.");
      }
    } else {
      add("ok", "Branch tracking", `Tracks ${upstream.stdout}.`);
    }
  }

  const ghAvailable = commandExists("gh", cwd);
  if (!ghAvailable) {
    add("warn", "GitHub CLI",
      "The GitHub CLI (gh) was not found. Authentication status was not checked.",
      "Install it from https://cli.github.com/, then run gh auth login.");
  } else {
    const auth = run("gh", ["auth", "status", "--hostname", "github.com"], cwd);
    if (auth.ok) {
      add("ok", "GitHub CLI authentication",
        "gh reports an authenticated GitHub account. This does not guarantee the remote's authentication method or repository permissions are correct.");
      add("warn", "Git credential setup",
        "If pushing over HTTPS still reports an authentication error, Git may not be using the GitHub CLI as its credential helper.",
        "Run gh auth setup-git, then retry git push. For SSH remotes, check your SSH key setup instead.");
    } else {
      add("warn", "GitHub CLI authentication",
        "GitHub CLI authentication could not be verified. The diagnostic intentionally does not display authentication command output.",
        "Run gh auth login and follow the prompts. Then run gh auth setup-git if you use an HTTPS remote.");
    }
  }

  return { cwd, checks };
}

module.exports = { diagnose };
