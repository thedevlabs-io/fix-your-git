"use strict";

// Order matters: the first match wins, and generic network errors also appear
// alongside more specific ones such as "Permission denied (publickey)".
const KNOWN_ERRORS = [
  {
    pattern: /Permission denied \(publickey\)/i,
    explain: () => ({
      title: "GitHub did not accept an SSH key from this computer",
      cause: "Your remote uses SSH, and either you have no SSH key or GitHub does not have its .pub half.",
      hint: "Run git-doctor in your project folder. It checks for a key and shows the exact command to switch this remote to HTTPS, which avoids SSH keys entirely.",
      commands: ["git-doctor"]
    })
  },
  {
    pattern: /Support for password authentication was removed|Invalid username or (password|token)|Authentication failed for/i,
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
      hint: "Print the URL and open it in your browser while signed in to GitHub. If the page is a 404, fix the URL (git-doctor shows the command) or create the repository first.",
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
    pattern: /\[rejected\]\s+(\S+) -> \S+ \((?:fetch first|non-fast-forward)\)|Updates were rejected because/i,
    explain: ([, branch]) => ({
      title: "GitHub has commits that you do not have yet",
      cause: "Someone pushed first, or you edited files on github.com (for example a README). Git will not overwrite that work.",
      hint: "Bring their commits in, then push again. Do not use --force; it deletes the commits on GitHub.",
      commands: [`git pull --rebase origin ${branch || "YOUR_BRANCH"}`, "git push"]
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
      hint: "cd into your project folder and run git-doctor. For a brand new project, start a repository there.",
      commands: ["git init -b main"]
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
    explain: ([, remote]) => ({
      title: `There is no remote called ${remote}`,
      cause: "Git does not know where to push because this project is not connected to GitHub yet.",
      hint: "Run git-doctor in your project folder; it shows the command to create and connect a GitHub repository.",
      commands: ["git-doctor"]
    })
  },
  {
    pattern: /Please tell me who you are|Author identity unknown/i,
    explain: () => ({
      title: "Git does not know your name and email",
      cause: "Every commit records who made it, and these settings are empty.",
      hint: "Set them once for this computer. git-doctor can suggest your GitHub no-reply email.",
      commands: ['git config --global user.name "Your Name"', 'git config --global user.email "you@example.com"']
    })
  },
  {
    pattern: /GH001: Large files detected|exceeds GitHub's file size limit/i,
    explain: (_, text) => {
      const file = (text.match(/File (\S+) is [\d.]+ ?MB/i) || [])[1] || "BIG_FILE";
      return {
        title: "A file is too big for GitHub",
        cause: `${file} is over GitHub's 100 MB limit, so the whole push was refused.`,
        hint: "If the file is in your latest commit only, take it out of that commit and ignore it. If it is in older commits too, ask for help before rewriting history.",
        commands: [`git rm --cached ${file}`, `echo ${file} >> .gitignore`, "git add .gitignore", "git commit --amend --no-edit", "git push"]
      };
    }
  },
  {
    pattern: /GH007|push would publish a private email/i,
    explain: () => ({
      title: "Your commit would publish your private email",
      cause: "Your GitHub settings block pushes that contain your personal email address.",
      hint: "Switch to your GitHub no-reply address (git-doctor shows yours when gh is signed in), then re-author the last commit.",
      commands: ["git-doctor", "git commit --amend --reset-author --no-edit", "git push"]
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
