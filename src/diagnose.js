"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
    return null;
  }
  if (!repo.ok || repo.stdout !== "true") {
    add("error", "Git repository",
      "This folder is not inside a Git working tree.",
      {
        hint: "If this is the wrong folder, cd into your project first. If this is a new project, start a repository here.",
        commands: ["git init -b main"]
      });
    return null;
  }
  const root = run("git", ["rev-parse", "--show-toplevel"], cwd).stdout;
  if (root && isHomeFolder(root)) {
    add("warn", "Git repository",
      `Your whole home folder (${root}) is a Git repository, usually from running git init in the wrong place.`,
      {
        hint: "If you did not mean to do that, delete the hidden .git folder in your home folder (your files stay), then run git init -b main inside your project folder. If you track dotfiles there on purpose, ignore this."
      });
    return root;
  }
  add("ok", "Git repository", `Repository root: ${root || "(could not determine root)"}`);
  return root || cwd;
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

function isShellSafe(value) {
  return Boolean(value) && !/["$`\\]/.test(value);
}

function checkAuthorName(cwd, add, github) {
  const name = run("git", ["config", "--get", "user.name"], cwd);
  if (name.ok && name.stdout) {
    add("ok", "Commit author name", "Configured.");
    return;
  }
  const knownName = isShellSafe(github.name) ? github.name : "";
  add("warn", "Commit author name",
    "Git user.name is not configured.",
    {
      hint: knownName
        ? "Git puts this name on every commit. This is the name on your GitHub profile; change it if you like."
        : "Git puts this name on every commit. Replace Your Name with your own.",
      commands: [`git config --global user.name "${knownName || "Your Name"}"`],
      autoFix: {
        question: "Your name, as it should appear on commits",
        defaultValue: github.name || "",
        isValid: value => value.length > 0,
        command: value => ["git", ["config", "--global", "user.name", value]]
      }
    });
}

function noReplyEmail(github) {
  return github.login && github.id ? `${github.id}+${github.login}@users.noreply.github.com` : "";
}

function checkAuthorEmail(cwd, add, github) {
  const email = run("git", ["config", "--get", "user.email"], cwd);
  if (email.ok && email.stdout) {
    add("ok", "Commit author email", "Configured.");
    return;
  }
  const suggested = noReplyEmail(github);
  add("warn", "Commit author email",
    "Git user.email is not configured.",
    {
      hint: suggested
        ? "This is your private GitHub no-reply address. It links commits to your profile without publishing your real email."
        : "Use the email of your GitHub account so commits link to your profile.",
      commands: [`git config --global user.email "${suggested || "you@example.com"}"`],
      autoFix: {
        question: "Your email for commits",
        defaultValue: suggested,
        isValid: value => /^[^\s@]+@[^\s@]+$/.test(value),
        command: value => ["git", ["config", "--global", "user.email", value]]
      }
    });
}

function listRemotes(cwd) {
  const remotesResult = run("git", ["remote"], cwd);
  return remotesResult.ok && remotesResult.stdout
    ? remotesResult.stdout.split(/\r?\n/).filter(Boolean)
    : [];
}

function suggestedRepoName(root) {
  return path.basename(root).replace(/[^A-Za-z0-9._-]+/g, "-") || "my-project";
}

function githubUrl(github, repoName) {
  return `https://github.com/${github.login || "YOUR_USERNAME"}/${repoName}.git`;
}

function missingRemoteFix(github, repoName) {
  if (github.authenticated) {
    return {
      hint: "This creates the repository on your GitHub account and connects it in one step. Use --public instead of --private if you want anyone to see it.",
      commands: [`gh repo create ${repoName} --private --source=. --remote=origin`]
    };
  }
  return {
    hint: `Create an empty repository named ${repoName} at https://github.com/new (leave README unticked), then connect it. Replace YOUR_USERNAME.`,
    commands: [`git remote add origin ${githubUrl(github, repoName)}`]
  };
}

function checkRemote(cwd, add, github, repoName) {
  const remotes = listRemotes(cwd);
  if (remotes.length === 0) {
    add("error", "Remote repository",
      "No Git remote is configured, so Git does not know where to push.",
      missingRemoteFix(github, repoName));
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
      commands: ["git remote -v", `git remote set-url ${remote} ${githubUrl(github, repoName)}`]
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

function readGitHubAccount(cwd) {
  if (!commandExists("gh", cwd)) return { installed: false, authenticated: false };
  const auth = run("gh", ["auth", "status", "--hostname", "github.com"], cwd);
  if (!auth.ok) return { installed: true, authenticated: false };
  const user = run("gh", ["api", "user", "--jq", '[.login, (.id | tostring), (.name // "")] | join("\\t")'], cwd);
  const [login = "", id = "", name = ""] = user.ok ? user.stdout.split("\t") : [];
  return { installed: true, authenticated: true, login, id, name };
}

function checkGitHubCli(add, github) {
  if (!github.installed) {
    add("warn", "GitHub CLI",
      "The GitHub CLI (gh) was not found. Authentication status was not checked.",
      {
        hint: "It is the easiest way to sign Git in to GitHub. Install it from https://cli.github.com/, then reopen your terminal and sign in.",
        commands: ["gh auth login"]
      });
    return;
  }
  if (github.authenticated) {
    add("ok", "GitHub CLI authentication",
      `gh is signed in${github.login ? ` as ${github.login}` : ""}. This does not guarantee the remote's authentication method or repository permissions are correct.`);
    return;
  }
  add("warn", "GitHub CLI authentication",
    "GitHub CLI authentication could not be verified. The diagnostic intentionally does not display authentication command output.",
    {
      hint: "Sign in and follow the prompts (choose GitHub.com, then HTTPS, then login with a web browser).",
      commands: ["gh auth login"]
    });
}

function isHttpsUrl(url) {
  return /^https?:\/\//i.test(url);
}

function checkCredentialHelper(cwd, add, ghAuthenticated) {
  const helpers = run("git", ["config", "--get-regexp", "^credential\\..*helper$"], cwd);
  const names = [...new Set(helpers.stdout.split(/\r?\n/)
    .map(line => line.split(/\s+/).slice(1).join(" "))
    .filter(Boolean))];
  if (helpers.ok && names.length > 0) {
    const usesGh = names.some(name => name.includes("gh auth git-credential"));
    add("ok", "Git credential setup",
      `Git saves HTTPS logins with: ${names.join(", ")}.` +
      (usesGh ? "" : " If git push asks for a password, run gh auth setup-git (GitHub does not accept account passwords)."));
    return;
  }
  add("warn", "Git credential setup",
    "Git has no credential helper, so HTTPS pushes will ask for a password. GitHub no longer accepts account passwords there.",
    ghAuthenticated
      ? {
        hint: "Let Git reuse your gh login for HTTPS pushes.",
        commands: ["gh auth setup-git"],
        autoFix: { command: () => ["gh", ["auth", "setup-git"]] }
      }
      : { hint: "Sign in with gh first (see the GitHub CLI step), then let Git reuse that login.", commands: ["gh auth setup-git"] });
}

function findSshPublicKeys() {
  const sshFolder = path.join(os.homedir(), ".ssh");
  try {
    return fs.readdirSync(sshFolder).filter(file => file.endsWith(".pub"));
  } catch {
    return [];
  }
}

function sshToHttpsUrl(url) {
  const match = url.match(/^(?:ssh:\/\/)?git@github\.com[:/](.+?)(?:\.git)?\/?$/i);
  return match ? `https://github.com/${match[1]}.git` : "";
}

function checkSshKey(add, remote, github) {
  const keys = findSshPublicKeys();
  if (keys.length > 0) {
    add("ok", "SSH key",
      `Found ${keys.join(", ")} in ~/.ssh. To confirm GitHub accepts it, run ssh -T git@github.com`);
    return;
  }
  const email = noReplyEmail(github) || "you@example.com";
  const httpsUrl = sshToHttpsUrl(remote.url);
  const keySteps = "create a key (press Enter to accept the defaults), then add the .pub file to GitHub" +
    (github.authenticated ? "." : " at https://github.com/settings/keys.");
  const sshSetup = {
    hint: `To fix this, ${keySteps}`,
    commands: [
      `ssh-keygen -t ed25519 -C "${email}"`,
      ...(github.authenticated ? ['gh ssh-key add ~/.ssh/id_ed25519.pub --title "My computer"'] : [])
    ]
  };
  add("warn", "SSH key",
    `${remote.name} uses SSH, but no SSH key was found in ~/.ssh, so GitHub will reply "Permission denied (publickey)".`,
    httpsUrl
      ? {
        hint: "Simplest fix: switch this remote to HTTPS and skip SSH keys entirely.",
        commands: [`git remote set-url ${remote.name} ${httpsUrl}`],
        alternative: { ...sshSetup, hint: `Or, to keep SSH, ${keySteps}` }
      }
      : sshSetup);
}

function diagnose(cwd = process.cwd()) {
  const checks = [];
  const add = (status, title, message, fix = {}) =>
    checks.push({ status, title, message, ...fix });

  if (!checkGit(cwd, add)) return { cwd, checks };
  const root = checkRepository(cwd, add);
  if (!root) return { cwd, checks };
  const github = readGitHubAccount(cwd);
  checkAuthorName(cwd, add, github);
  checkAuthorEmail(cwd, add, github);
  const branchState = checkBranch(cwd, add);
  const remote = checkRemote(cwd, add, github, suggestedRepoName(root));
  checkGitHubCli(add, github);
  if (!remote || isHttpsUrl(remote.url)) checkCredentialHelper(cwd, add, github.authenticated);
  else checkSshKey(add, remote, github);
  if (remote) checkUpstream(cwd, add, branchState, remote);

  return { cwd, checks };
}

module.exports = { diagnose };
