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
        hint: "Do not run git init here: it would track every file you own. Move into your project folder and run fix-your-git again (replace the path).",
        commands: ["cd path/to/your-project"]
      });
    return null;
  }
  if (!repo.ok || repo.stdout !== "true") {
    add("error", "Git repository",
      "This folder is not inside a Git working tree.",
      {
        hint: "If this is the wrong folder, cd into your project first. If this is a new project, start a repository here.",
        commands: ["git init", "git checkout -b main"]
      });
    return null;
  }
  const root = run("git", ["rev-parse", "--show-toplevel"], cwd).stdout;
  if (root && isHomeFolder(root)) {
    add("warn", "Git repository",
      `Your whole home folder (${root}) is a Git repository, usually from running git init in the wrong place.`,
      {
        hint: "If you did not mean to do that, delete the hidden .git folder in your home folder (your files stay), then run git init inside your project folder. If you track dotfiles there on purpose, ignore this."
      });
    return root;
  }
  add("ok", "Git repository", `Repository root: ${root || "(could not determine root)"}`);
  return root || cwd;
}

function operationInProgress(cwd) {
  const gitDir = run("git", ["rev-parse", "--git-dir"], cwd).stdout;
  const exists = name => fs.existsSync(path.resolve(cwd, gitDir, name));
  if (exists("rebase-merge") || exists("rebase-apply")) return "rebase";
  if (exists("BISECT_LOG")) return "bisect";
  return "";
}

function reportNoBranch(cwd, add) {
  const operation = operationInProgress(cwd);
  if (operation === "rebase") {
    add("warn", "Current branch",
      "A rebase is in progress, so you are temporarily not on a branch.",
      {
        hint: "Finish it: fix any conflicts git status lists, git add those files, then continue.",
        commands: ["git status", "git rebase --continue"],
        more: [{ hint: "Or cancel the rebase and go back to how things were.", commands: ["git rebase --abort"] }]
      });
    return;
  }
  if (operation === "bisect") {
    add("warn", "Current branch",
      "A git bisect is in progress, so you are temporarily not on a branch.",
      { hint: "End the bisect to return to your branch.", commands: ["git bisect reset"] });
    return;
  }
  add("warn", "Current branch",
    "You are on a detached HEAD: commits made now do not belong to any branch and are easy to lose.",
    {
      hint: "Save where you are as a new branch first, so nothing gets lost. Replace my-work with any name, then push that branch.",
      commands: ["git switch -c my-work"]
    });
}

const KEEP_OUT_OF_GIT = [".env", ".env.local", "node_modules", ".venv", "venv", "__pycache__"];

const RISKY_SEARCH_DEPTH = 3;

function findRiskyPaths(root, relative = "", depth = 0) {
  if (depth > RISKY_SEARCH_DEPTH) return [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap(entry => {
    const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
    if (KEEP_OUT_OF_GIT.includes(entry.name)) return [{ path: entryPath, name: entry.name, isDirectory: entry.isDirectory() }];
    if (!entry.isDirectory() || entry.name === ".git") return [];
    return findRiskyPaths(root, entryPath, depth + 1);
  });
}

// Bare names like node_modules/ in .gitignore match at any depth.
function ignoreLine({ name, isDirectory }) {
  return isDirectory ? `${name}/` : name;
}

// --no-index checks the .gitignore rules alone; without it, a file that is
// already staged reports as not ignored even after the rule is added.
function riskyFileState(root) {
  const present = findRiskyPaths(root);
  return {
    unignored: present.filter(entry => !run("git", ["check-ignore", "--quiet", "--no-index", entry.path], root).ok),
    staged: present.filter(entry => run("git", ["ls-files", "--cached", "--", entry.path], root).stdout !== "")
  };
}

function checkIgnoreFile(root, add) {
  const { unignored, staged } = riskyFileState(root);
  if (unignored.length === 0 && staged.length === 0) return;
  const paths = [...new Set([...unignored, ...staged].map(entry => entry.path))];
  const unstage = {
    hint: "These are already staged. Unstage them (the files stay on your disk).",
    commands: staged.map(entry => `git rm -r --cached ${entry.path}`)
  };
  const addRules = {
    hint: "Open .gitignore in your project folder in your editor (create it if it does not exist).",
    commandsLabel: "Add these lines:",
    commands: [...new Set(unignored.map(ignoreLine))]
  };
  add("warn", "Files to keep out of Git",
    `${paths.join(", ")} would be included in your first commit. Secrets in .env become public once pushed, and dependency folders are huge.`,
    unignored.length === 0 ? unstage : { ...addRules, more: staged.length > 0 ? [unstage] : [] });
}

function checkBranch(cwd, add, root) {
  const branch = run("git", ["branch", "--show-current"], cwd).stdout;
  if (!branch) {
    reportNoBranch(cwd, add);
    return { branch, hasCommits: true };
  }
  add("ok", "Current branch", branch);

  const hasCommits = run("git", ["rev-parse", "--verify", "--quiet", "HEAD"], cwd).ok;
  if (!hasCommits) {
    checkIgnoreFile(root, add);
    add("warn", "First commit",
      `Branch "${branch}" has no commits yet, so there is nothing to push.`,
      {
        hint: "git status lists what will be saved. If anything there should stay private or is generated, add it to .gitignore before you commit.",
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
  const name = path.basename(root).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return name || "my-project";
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
  const kind = remoteKind(remoteUrl);
  const isGitHub = /(^|[/:@])github\.com([/:]|$)/i.test(remoteUrl);
  add(isGitHub ? "ok" : "warn", "Remote repository",
    `${remote} is configured${isGitHub ? " for GitHub" : ", but its URL does not look like a GitHub URL"}.` +
    (remoteUrl ? ` URL: ${safeRemoteUrl(remoteUrl)}` : ""),
    isGitHub ? {} : {
      hint: "Check the URL. If it is wrong, replace it with your GitHub repository URL." +
        (kind === "ssh" ? " If it is an SSH host alias from ~/.ssh/config, ignore this." : ""),
      commands: ["git remote -v", `git remote set-url ${remote} ${githubUrl(github, repoName)}`]
    });

  return { name: remote, url: remoteUrl, kind };
}

function checkUpstream(cwd, add, { branch, hasCommits }, { name: remote }) {
  if (!hasCommits) {
    add("warn", "Branch tracking",
      "Nothing to push until you make your first commit.",
      {
        hint: "After committing, push once with -u so Git remembers where this branch goes.",
        commands: [`git push -u ${remote} ${branch}`]
      });
    return;
  }
  const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
  if (upstream.ok) {
    add("ok", "Branch tracking", `Tracks ${upstream.stdout}.`);
  } else {
    add("warn", "Branch tracking",
      `Branch "${branch}" does not appear to track a remote branch.`,
      {
        hint: "Push once with -u so Git remembers where this branch goes. After that, plain git push works.",
        commands: [`git push -u ${remote} ${branch}`]
      });
  }
}

const GH_API_TIMEOUT_MS = 5000;

function readGitHubAccount(cwd) {
  if (!commandExists("gh", cwd)) return { installed: false, authenticated: false };
  // gh auth status validates the token online, so offline it looks signed out.
  // gh auth token only reads the stored login; its output is never shown.
  const auth = run("gh", ["auth", "token", "--hostname", "github.com"], cwd);
  if (!auth.ok) return { installed: true, authenticated: false };
  const user = run("gh", ["api", "user", "--jq", '[.login, (.id | tostring), (.name // "")] | join("\\t")'], cwd, GH_API_TIMEOUT_MS);
  if (!user.ok && /HTTP 401|Bad credentials/i.test(user.stderr)) {
    return { installed: true, authenticated: false, expired: true };
  }
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
      github.login
        ? `gh is signed in as ${github.login}. This does not guarantee the remote's authentication method or repository permissions are correct.`
        : "gh has a saved login, but GitHub could not be reached to load your profile. Check your internet connection if pushing fails.");
    return;
  }
  add("warn", "GitHub CLI authentication",
    github.expired
      ? "Your saved gh login has expired or was revoked, so GitHub rejects it."
      : "GitHub CLI authentication could not be verified. The diagnostic intentionally does not display authentication command output.",
    {
      hint: "Sign in and follow the prompts (choose GitHub.com, then HTTPS, then login with a web browser).",
      commands: ["gh auth login"]
    });
}

function remoteKind(url) {
  if (/^https?:\/\//i.test(url)) return "https";
  // scp-style "user@host:path" or "host.tld:path"; without a user, the host
  // needs a dot so Windows drives like C: are not mistaken for SSH.
  if (/^ssh:\/\//i.test(url) || /^(?:[\w.-]+@[\w.-]+|[\w-]+(?:\.[\w-]+)+):(?!\/\/)/.test(url)) return "ssh";
  return "other";
}

// Git treats an empty helper value as "forget the helpers listed so far".
function activeHelpers(configOutput) {
  const active = [];
  for (const line of configOutput.split(/\r?\n/).filter(Boolean)) {
    const value = line.split(/\s+/).slice(1).join(" ");
    if (value) active.push(value);
    else active.length = 0;
  }
  return [...new Set(active)];
}

function checkCredentialHelper(cwd, add, ghAuthenticated) {
  const helpers = run("git", ["config", "--get-regexp", "^credential\\..*helper$"], cwd);
  const names = activeHelpers(helpers.stdout);
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
  const match = url.match(/^ssh:\/\/git@github\.com(?::\d+)?\/(.+?)(?:\.git)?\/?$/i) ||
    url.match(/^git@github\.com:(.+?)(?:\.git)?\/?$/i);
  return match ? `https://github.com/${match[1]}.git` : "";
}

function publicKeyPathForShell() {
  return process.platform === "win32"
    ? `"${path.join(os.homedir(), ".ssh", "id_ed25519.pub")}"`
    : "~/.ssh/id_ed25519.pub";
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
      ...(github.authenticated ? [`gh ssh-key add ${publicKeyPathForShell()} --title "My computer"`] : [])
    ]
  };
  add("warn", "SSH key",
    `${remote.name} uses SSH, but no SSH key was found in ~/.ssh, so GitHub will reply "Permission denied (publickey)".`,
    httpsUrl
      ? {
        hint: "Simplest fix: switch this remote to HTTPS and skip SSH keys entirely.",
        commands: [`git remote set-url ${remote.name} ${httpsUrl}`],
        more: [{ ...sshSetup, hint: `Or, to keep SSH, ${keySteps}` }]
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
  const branchState = checkBranch(cwd, add, root);
  const remote = checkRemote(cwd, add, github, suggestedRepoName(root));
  checkGitHubCli(add, github);
  if (!remote || remote.kind === "https") checkCredentialHelper(cwd, add, github.authenticated);
  else if (remote.kind === "ssh") checkSshKey(add, remote, github);
  if (remote && branchState.branch) checkUpstream(cwd, add, branchState, remote);

  return { cwd, checks };
}

module.exports = { diagnose };
