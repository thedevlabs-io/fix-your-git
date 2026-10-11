"use strict";

// Install folders are never source at any depth; build output names are only
// safe to treat that way at the root, where src/build could be real code.
const INSTALL_FOLDERS = ["node_modules", ".venv", "venv"];
const ROOT_OUTPUT_FOLDERS = ["dist", "build", "vendor"];

function quoteIfNeeded(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

// GitHub also prints "warning: File X is 62 MB" for files it accepts, so
// prefer the file named on an error line.
function rejectedFile(text) {
  const match = text.match(/error: File (.+?) is [\d.]+ ?MB/i) || text.match(/File (.+?) is [\d.]+ ?MB/i);
  return match ? match[1] : "BIG_FILE";
}

function dependencyFolderOf(file) {
  const segments = file.split("/");
  const index = segments.findIndex(segment => INSTALL_FOLDERS.includes(segment));
  if (index !== -1) return { path: segments.slice(0, index + 1).join("/"), ignoreLine: `${segments[index]}/` };
  if (segments.length > 1 && ROOT_OUTPUT_FOLDERS.includes(segments[0])) {
    return { path: segments[0], ignoreLine: `/${segments[0]}/` };
  }
  return null;
}

function explainLargeFile(text) {
  const file = rejectedFile(text);
  const dependency = dependencyFolderOf(file);
  const folder = dependency && dependency.path;
  const ignoreLine = dependency ? dependency.ignoreLine : file;
  return {
    title: "A file is too big for GitHub",
    cause: `${file} is over GitHub's 100 MB limit, so the whole push was refused.` +
      (folder ? ` It is inside ${folder}/, which should never be committed.` : ""),
    hint: "If it was added in your latest commit only, take it out of Git first (it stays on your disk). If it is in older commits too, ask someone for help before rewriting history.",
    commands: [folder ? `git rm -r --cached ${quoteIfNeeded(folder)}` : `git rm --cached ${quoteIfNeeded(file)}`],
    more: [
      { hint: "Open .gitignore in your editor (create it if needed) so it is not added again.", commandsLabel: "Add this line:", commands: [ignoreLine] },
      { hint: "Then update the commit and push.", commands: ["git add .gitignore", "git commit --amend --no-edit", "git push"] }
    ]
  };
}

function explainMissingRemote(target) {
  if (/[/\\:]/.test(target)) {
    return {
      title: "Your remote points at a folder that does not exist",
      cause: `The remote URL is a path on this computer (${target}), and there is no repository there.`,
      hint: "Point it at your GitHub repository instead. Replace YOUR_USERNAME and REPOSITORY.",
      commands: ["git remote -v", "git remote set-url origin https://github.com/YOUR_USERNAME/REPOSITORY.git"]
    };
  }
  return {
    title: `There is no remote called ${target}`,
    cause: "Git does not know where to push because this project is not connected to GitHub yet.",
    hint: "Run fix-your-git in your project folder; it shows the command to create and connect a GitHub repository.",
    commands: ["fix-your-git"]
  };
}

// Order matters: the first match wins, and generic network errors also appear
// alongside more specific ones such as "Permission denied (publickey)".
const KNOWN_ERRORS = [
  {
    pattern: /Permission denied \(publickey\)/i,
    explain: () => ({
      title: "GitHub did not accept an SSH key from this computer",
      cause: "Your remote uses SSH, and either you have no SSH key or GitHub does not have the .pub half of it.",
      hint: "Simplest fix: switch the remote to HTTPS and skip SSH keys. Replace OWNER/REPO with the part after github.com in your remote URL.",
      commands: ["git remote -v", "git remote set-url origin https://github.com/OWNER/REPO.git"],
      more: [{
        hint: "Or, to keep SSH, test the key. If it is rejected, run fix-your-git for the commands to create and add one.",
        commands: ["ssh -T git@github.com"]
      }]
    })
  },
  {
    pattern: /Support for password authentication was removed|Invalid username or (password|token)|Authentication failed/i,
    explain: () => ({
      title: "GitHub rejected your password",
      cause: "GitHub stopped accepting account passwords for git push in 2021. Git needs a token, which gh can set up for you.",
      hint: "Sign in with the GitHub CLI, then let Git reuse that login. Get gh from https://cli.github.com/ if you do not have it.",
      commands: ["gh auth login", "gh auth setup-git", "git push"]
    })
  },
  {
    pattern: /Permission to (\S+?) denied to (\S+?)\.?$/im,
    explain: ([, repo, user]) => ({
      title: "Signed in as an account that cannot push here",
      cause: `GitHub knows you as ${user}, and that account has no write access to ${repo.replace(/\.git$/, "")}.`,
      hint: "If the repository is yours, sign in as its owner. If it belongs to someone else, ask them to add you as a collaborator, or fork it and push to your fork.",
      commands: ["gh auth status", "gh auth login"]
    })
  },
  {
    pattern: /The requested URL returned error: 403/i,
    explain: () => ({
      title: "GitHub refused the push (403)",
      cause: "You are signed in, but that account does not have write access to this repository.",
      hint: "Check which account you are using. Sign in as the owner, or ask the owner to add you as a collaborator.",
      commands: ["gh auth status", "gh auth login"]
    })
  },
  {
    pattern: /Repository not found|repository '.*' not found/i,
    explain: () => ({
      title: "GitHub cannot find that repository",
      cause: "The remote URL has a typo, the repository was never created, or it is private and your account cannot see it.",
      hint: "Print the URL and open it in your browser while signed in to GitHub. If the page is a 404, fix the URL (fix-your-git shows the command) or create the repository first.",
      commands: ["git remote -v"]
    })
  },
  {
    pattern: /src refspec (\S+) does not match any/i,
    explain: ([, branch]) => ({
      title: `There is no branch called ${branch} to push yet`,
      cause: `Either you have not made a commit yet, or your branch has a different name (often master instead of main).`,
      hint: "Check both. Commit first if git status says there are no commits; otherwise push the branch name that git branch prints.",
      commands: ["git status", "git branch"]
    })
  },
  {
    pattern: /refusing to merge unrelated histories/i,
    explain: () => ({
      title: "Your project and the GitHub repository started separately",
      cause: "This usually happens when the repository was created on GitHub with a README or licence, and you then tried to pull it into an existing project.",
      hint: "Merge the two histories once, then push. Replace main if your branch has another name.",
      commands: ["git pull origin main --allow-unrelated-histories --no-rebase", "git push"]
    })
  },
  {
    pattern: /\[rejected\]\s+(\S+) -> \S+ \((?:fetch first|non-fast-forward)\)|Updates were rejected because the (?:remote contains work|tip of your current branch is behind)/i,
    explain: ([, branch]) => ({
      title: "GitHub has commits that you do not have yet",
      cause: "Someone pushed first, or you edited files on github.com (for example a README). Git will not overwrite that work.",
      hint: "Bring their commits in, then push again. Do not use --force; it deletes the commits on GitHub.",
      commands: [`git pull --rebase origin ${branch || "YOUR_BRANCH"}`, "git push"]
    })
  },
  {
    pattern: /\[rejected\]\s+(\S+) -> \S+ \(already exists\)|tag already exists in the remote/i,
    explain: ([, tag]) => ({
      title: tag ? `A tag called ${tag} is already on GitHub` : "That tag is already on GitHub",
      cause: "Tags mark a fixed point in history, so Git will not move one that has been pushed.",
      hint: "Pick a new tag name, for example the next version number, and push that instead.",
      commands: ["git tag NEW_TAG", "git push origin NEW_TAG"]
    })
  },
  {
    pattern: /Need to specify how to reconcile divergent branches/i,
    explain: () => ({
      title: "Git needs to know how to combine your work with GitHub's",
      cause: "Both you and GitHub have new commits. Git asks whether to rebase or merge them.",
      hint: "Rebase puts your commits on top of GitHub's, which keeps history simple.",
      commands: ["git pull --rebase", "git push"]
    })
  },
  {
    pattern: /Your local changes to the following files would be overwritten by checkout/i,
    explain: () => ({
      title: "Switching branches would overwrite your unsaved changes",
      cause: "You have edits that are not committed, and the other branch has different versions of those files.",
      hint: "Put your changes aside, switch, then bring them back on whichever branch they belong to. Replace OTHER_BRANCH.",
      commands: ["git stash", "git switch OTHER_BRANCH", "git stash pop"]
    })
  },
  {
    pattern: /Your local changes to the following files would be overwritten by merge|cannot pull with rebase: You have unstaged changes/i,
    explain: () => ({
      title: "You have unsaved changes in the way",
      cause: "Git will not pull while you have edits that are not committed, because they could be overwritten.",
      hint: "Put your changes aside, pull, then bring them back. If the last step reports a conflict, git status shows the files to fix.",
      commands: ["git stash", "git pull --rebase", "git stash pop"]
    })
  },
  {
    pattern: /has no upstream branch[\s\S]*?git push --set-upstream (\S+) (\S+)/i,
    explain: ([, remote, branch]) => ({
      title: "This branch has not been pushed before",
      cause: "Git does not know which branch on GitHub this one belongs to.",
      hint: "Push once with -u. After that, plain git push works.",
      commands: [`git push -u ${remote} ${branch}`]
    })
  },
  {
    pattern: /not a git repository/i,
    explain: () => ({
      title: "This folder is not a Git repository",
      cause: "You are probably in the wrong folder, or the project was never set up with git init.",
      hint: "cd into your project folder and run fix-your-git. For a brand new project, start a repository there.",
      commands: ["git init", "git checkout -b main"]
    })
  },
  {
    pattern: /remote (\S+) already exists/i,
    explain: ([, remote]) => ({
      title: `A remote called ${remote} is already set`,
      cause: "git remote add only works once per name. To point it somewhere else, change its URL instead.",
      hint: "Replace the URL with your GitHub repository.",
      commands: [`git remote set-url ${remote} https://github.com/YOUR_USERNAME/REPOSITORY.git`]
    })
  },
  {
    pattern: /'(\S+)' does not appear to be a git repository/i,
    explain: ([, target]) => explainMissingRemote(target)
  },
  {
    pattern: /Please tell me who you are|Author identity unknown/i,
    explain: () => ({
      title: "Git does not know your name and email",
      cause: "Every commit records who made it, and these settings are empty.",
      hint: "Set them once for this computer. fix-your-git can suggest your GitHub no-reply email.",
      commands: ['git config --global user.name "Your Name"', 'git config --global user.email "you@example.com"']
    })
  },
  {
    pattern: /GH001: Large files detected|exceeds GitHub's file size limit/i,
    explain: (_, text) => explainLargeFile(text)
  },
  {
    pattern: /GH007|push would publish a private email/i,
    explain: () => ({
      title: "Your commit would publish your private email",
      cause: "Your GitHub settings block pushes that contain your personal email address.",
      hint: "Switch to your GitHub no-reply address. Find it at https://github.com/settings/emails (it looks like 12345+username@users.noreply.github.com) and use it below, then re-author the last commit. If several unpushed commits use the old email, ask someone for help.",
      commands: ['git config --global user.email "ID+USERNAME@users.noreply.github.com"', "git commit --amend --reset-author --no-edit", "git push"]
    })
  },
  {
    pattern: /could not read Username for .*terminal prompts disabled/i,
    explain: () => ({
      title: "Git needs to sign in but cannot ask you",
      cause: "The push ran somewhere that cannot show a login prompt, such as an editor button or a script.",
      hint: "Sign in once with the GitHub CLI and let Git reuse that login, then try again.",
      commands: ["gh auth login", "gh auth setup-git"]
    })
  },
  {
    pattern: /Could not resolve host|Connection timed out|Failed to connect|Could not read from remote repository/i,
    explain: () => ({
      title: "Git could not reach GitHub",
      cause: "There is a network problem: no internet, a proxy or firewall, or GitHub is having an outage.",
      hint: "Check that https://github.com opens in your browser, and look at https://www.githubstatus.com. On office or college Wi-Fi, try another network.",
      commands: []
    })
  }
];

function firstErrorLine(text) {
  return text.split(/\r?\n/).find(line => /^\s*(fatal|error|remote: error):/i.test(line)) || "";
}

function explain(text) {
  for (const known of KNOWN_ERRORS) {
    const match = text.match(known.pattern);
    if (match) return known.explain(match, text);
  }
  return null;
}

module.exports = { explain, firstErrorLine };
