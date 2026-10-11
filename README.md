# git-doctor

A beginner-friendly, cross-platform CLI that diagnoses common Git/GitHub push setup problems.

## Requirements

- Node.js 18+
- Git installed and available on your PATH
- Optional: GitHub CLI (`gh`) for authentication checks

## Run locally

From this project directory:

```bash
npm run check
npm start
```

To test it against another project, run the script from that project's directory:

```bash
node /path/to/git-doctor/bin/git-doctor.js
```

## Install globally for development

```bash
npm link
git-doctor
```

Or, after publishing the package to npm:

```bash
npx git-doctor
```

## What it checks

- Git availability
- Whether the current directory is inside a Git work tree
- Current branch (including a possible detached HEAD)
- `user.name` and `user.email`
- Configured remotes and whether the selected remote looks like GitHub
- Whether the current branch has an upstream
- Whether `gh` is installed and reports an authenticated GitHub account

## Authentication guidance

Install GitHub CLI from https://cli.github.com/ and run:

```bash
gh auth login
gh auth setup-git
```

`gh auth setup-git` can configure Git to use GitHub CLI for HTTPS credentials. For SSH remotes, make sure an SSH key is configured with GitHub.

Never paste a personal access token into `.git/config`, commit credentials, or share terminal output containing secrets.

## Safety and limitations

- This tool is diagnostic only; it does not modify repository configuration or files.
- It does not attempt a network push, so it cannot prove that GitHub will accept one.
- A configured remote does not prove that the user has write permission.
- A successful `gh auth status` does not guarantee that Git itself is using the same credentials, particularly with SSH remotes.
- Review every suggested command before running it. Replace placeholder values such as `USERNAME` and `REPOSITORY`.

## Before publishing

Choose a unique npm package name if `git-doctor` is already taken. Add tests, a license file, and a repository URL before publishing.
