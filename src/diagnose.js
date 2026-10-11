"use strict";

const fs = require("node:fs");
const os = require("node:os");
const { run, commandExists } = require("./run");

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

function checkGit(cwd, add) {
  const gitVersion = run("git", ["--version"], cwd);
  if (!gitVersion.ok) {
    add("error", "Git installed",
      "Git was not found or could not be started.",
      { hint: "Install Git from https://git-scm.com/downloads, then close and reopen your terminal so it can find git." });
    return false;
  }
  add("ok", "Git installed", gitVersion.stdout);
  return true;
}

function isHomeFolder(folder) {
  return fs.realpathSync(folder) === fs.realpathSync(os.homedir());
}

function checkRepository(cwd, add) {
  const repo = run("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  if ((!repo.ok || repo.stdout !== "true") && isHomeFolder(cwd)) {
    add("error", "Git repository",
      "You are in your home folder, not a project folder.",
      {
        hint: "Do not run git init here: it would track every file you own. Move into your project folder and run git-doctor again (replace the path).",
        commands: ["cd path/to/your-project"]
      });
    return false;
  }
  if (!repo.ok || repo.stdout !== "true") {
    add("error", "Git repository",
      "This folder is not inside a Git working tree.",
      {
        hint: "If this is the wrong folder, cd into your project first. If this is a new project, start a repository here.",
        commands: ["git init -b main"]
      });
    return false;
  }
  const root = run("git", ["rev-parse", "--show-toplevel"], cwd).stdout;
  if (root && isHomeFolder(root)) {
    add("warn", "Git repository",
      `Your whole home folder (${root}) is a Git repository, usually from running git init in the wrong place.`,
      {
        hint: "If you did not mean to do that, delete the hidden .git folder in your home folder (your files stay), then run git init -b main inside your project folder. If you track dotfiles there on purpose, ignore this."
      });
    return true;
  }
  add("ok", "Git repository", `Repository root: ${root || "(could not determine root)"}`);
  return true;
}

function checkBranch(cwd, add) {
  const branch = run("git", ["branch", "--show-current"], cwd).stdout;
  if (!branch) {
    add("warn", "Current branch",
      "Git did not report a branch name; you may be in a detached HEAD state.",
      {
        hint: "List your branches, then switch to the one you meant to work on (replace YOUR_BRANCH).",
        commands: ["git branch", "git switch YOUR_BRANCH"]
      });
    return { branch, hasCommits: true };
  }
  add("ok", "Current branch", branch);

  const hasCommits = run("git", ["rev-parse", "--verify", "--quiet", "HEAD"], cwd).ok;
  if (!hasCommits) {
    add("warn", "First commit",
      `Branch "${branch}" has no commits yet, so there is nothing to push.`,
      {
        hint: "Check what will be saved first. Add a .gitignore so files like .env and node_modules stay out, then commit.",
        commands: ["git status", "git add .", 'git commit -m "First commit"']
      });
  }
  return { branch, hasCommits };
}

function checkAuthor(cwd, add) {
  const name = run("git", ["config", "--get", "user.name"], cwd);
  const email = run("git", ["config", "--get", "user.email"], cwd);
  if (!name.ok || !name.stdout) {
    add("warn", "Commit author name",
      "Git user.name is not configured.",
      {
        hint: "Git puts this name on every commit. Replace Your Name with your own.",
        commands: ['git config --global user.name "Your Name"']
      });
  } else {
    add("ok", "Commit author name", "Configured.");
  }
  if (!email.ok || !email.stdout) {
    add("warn", "Commit author email",
      "Git user.email is not configured.",
      {
        hint: "Use the email of your GitHub account so commits link to your profile.",
        commands: ['git config --global user.email "you@example.com"']
      });
  } else {
    add("ok", "Commit author email", "Configured.");
  }
}

function listRemotes(cwd) {
  const remotesResult = run("git", ["remote"], cwd);
  return remotesResult.ok && remotesResult.stdout
    ? remotesResult.stdout.split(/\r?\n/).filter(Boolean)
    : [];
}

function checkRemote(cwd, add) {
  const remotes = listRemotes(cwd);
  if (remotes.length === 0) {
    add("error", "Remote repository",
      "No Git remote is configured, so Git does not know where to push.",
      {
        hint: "Create an empty repository at https://github.com/new (leave README unticked), then connect it. Replace YOUR_USERNAME and REPOSITORY.",
        commands: ["git remote add origin https://github.com/YOUR_USERNAME/REPOSITORY.git"]
      });
    return null;
  }

  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  const remoteUrl = run("git", ["remote", "get-url", remote], cwd).stdout;
  const isGitHub = /(^|[/:@])github\.com([/:]|$)/i.test(remoteUrl);
  add(isGitHub ? "ok" : "warn", "Remote repository",
    `${remote} is configured${isGitHub ? " for GitHub" : ", but its URL does not look like a GitHub URL"}.` +
    (remoteUrl ? ` URL: ${safeRemoteUrl(remoteUrl)}` : ""),
    isGitHub ? {} : {
      hint: "Check the URL. If it is wrong, replace it with your GitHub repository URL.",
      commands: ["git remote -v", `git remote set-url ${remote} https://github.com/YOUR_USERNAME/REPOSITORY.git`]
    });

  return { name: remote, url: remoteUrl, remotes };
}

function checkUpstream(cwd, add, { branch, hasCommits }, { remotes }) {
  if (!hasCommits) {
    add("warn", "Branch tracking",
      "Nothing to push until you make your first commit.",
      {
        hint: "After committing, push once with -u so Git remembers where this branch goes.",
        commands: [`git push -u origin ${branch}`]
      });
    return;
  }
  const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
  if (upstream.ok) {
    add("ok", "Branch tracking", `Tracks ${upstream.stdout}.`);
  } else if (branch && remotes.includes("origin")) {
    add("warn", "Branch tracking",
      `Branch "${branch}" does not appear to track a remote branch.`,
      {
        hint: "Push once with -u so Git remembers where this branch goes. After that, plain git push works.",
        commands: [`git push -u origin ${branch}`]
      });
  } else {
    add("warn", "Branch tracking",
      "An upstream branch could not be detected.",
      {
        hint: "Push once with -u to set it. Replace REMOTE and BRANCH.",
        commands: ["git push -u REMOTE BRANCH"]
      });
  }
}

function checkGitHubCli(cwd, add) {
  if (!commandExists("gh", cwd)) {
    add("warn", "GitHub CLI",
      "The GitHub CLI (gh) was not found. Authentication status was not checked.",
      {
        hint: "It is the easiest way to sign Git in to GitHub. Install it from https://cli.github.com/, then reopen your terminal and sign in.",
        commands: ["gh auth login"]
      });
    return false;
  }
  const auth = run("gh", ["auth", "status", "--hostname", "github.com"], cwd);
  if (auth.ok) {
    add("ok", "GitHub CLI authentication",
      "gh reports an authenticated GitHub account. This does not guarantee the remote's authentication method or repository permissions are correct.");
    return true;
  }
  add("warn", "GitHub CLI authentication",
    "GitHub CLI authentication could not be verified. The diagnostic intentionally does not display authentication command output.",
    {
      hint: "Sign in and follow the prompts (choose GitHub.com, then HTTPS, then login with a web browser).",
      commands: ["gh auth login"]
    });
  return false;
}

function isHttpsUrl(url) {
  return /^https?:\/\//i.test(url);
}

function checkCredentialHelper(cwd, add, ghAuthenticated) {
  const helpers = run("git", ["config", "--get-regexp", "^credential\\..*helper$"], cwd);
  if (helpers.ok && helpers.stdout) {
    const names = [...new Set(helpers.stdout.split(/\r?\n/).map(line => line.split(/\s+/).slice(1).join(" ")))];
    const usesGh = names.some(name => name.includes("gh auth git-credential"));
    add("ok", "Git credential setup",
      `Git saves HTTPS logins with: ${names.join(", ")}.` +
      (usesGh ? "" : " If git push asks for a password, run gh auth setup-git (GitHub does not accept account passwords)."));
    return;
  }
  add("warn", "Git credential setup",
    "Git has no credential helper, so HTTPS pushes will ask for a password. GitHub no longer accepts account passwords there.",
    ghAuthenticated
      ? { hint: "Let Git reuse your gh login for HTTPS pushes.", commands: ["gh auth setup-git"] }
      : { hint: "Sign in with gh first (see the GitHub CLI step), then let Git reuse that login.", commands: ["gh auth setup-git"] });
}

function diagnose(cwd = process.cwd()) {
  const checks = [];
  const add = (status, title, message, fix = {}) =>
    checks.push({ status, title, message, ...fix });

  if (!checkGit(cwd, add)) return { cwd, checks };
  if (!checkRepository(cwd, add)) return { cwd, checks };
  checkAuthor(cwd, add);
  const branchState = checkBranch(cwd, add);
  const remote = checkRemote(cwd, add);
  const ghAuthenticated = checkGitHubCli(cwd, add);
  if (!remote || isHttpsUrl(remote.url)) checkCredentialHelper(cwd, add, ghAuthenticated);
  if (remote) checkUpstream(cwd, add, branchState, remote);

  return { cwd, checks };
}

module.exports = { diagnose };
