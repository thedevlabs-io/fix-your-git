# fix-your-git

A beginner-friendly, cross-platform CLI that diagnoses common Git/GitHub push setup problems.

## Quick start

Run it from inside your project folder, no install needed:

```bash
npx @thedevlabs-io/fix-your-git
```

Or install it once and use the short command:

```bash
npm install -g @thedevlabs-io/fix-your-git
fix-your-git
```

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
node /path/to/fix-your-git/bin/fix-your-git.js
```

## Usage

Run it from inside your project folder:

```bash
fix-your-git            # check your setup and get numbered steps to fix it
fix-your-git --fix      # the same check, then offer to fix the simple problems
fix-your-git explain    # paste an error from git and get a plain-English fix
fix-your-git --help
```

`explain` also takes the error as an argument or from a pipe:

```bash
fix-your-git explain "error: src refspec main does not match any"
git push 2>&1 | fix-your-git explain
```

It recognises the usual push and pull failures: `Permission denied (publickey)`, removed
password authentication, `terminal prompts disabled`, 403 and `Permission to ... denied`,
`Repository not found`, rejected pushes and tags, divergent branches, local changes in the way,
unrelated histories, missing upstream, files over 100 MB, GH007 private email, and network
errors.

The exit code is 0 when nothing is broken (warnings allowed), 1 when a check fails, and 2 for
bad usage.

## Install globally for development

```bash
npm link
fix-your-git
```

## What it checks

- Git availability
- Whether the current directory is inside a Git work tree, and whether you are in your home
  folder by mistake or turned it into a repository
- `user.name` and `user.email`
- Current branch (including a possible detached HEAD) and whether it has any commits yet
- Configured remotes and whether the selected remote looks like GitHub
- Whether `gh` is installed and reports an authenticated GitHub account
- For HTTPS remotes, whether Git has a credential helper; for SSH remotes, whether
  `~/.ssh` holds a public key
- Whether the current branch has an upstream

Problems are listed as numbered steps in the order that works, each with the exact commands
to copy. When `gh` is signed in, those commands are filled in with your GitHub profile name,
your private no-reply email, and a `gh repo create` named after the folder.

## Authentication guidance

Install GitHub CLI from https://cli.github.com/ and run:

```bash
gh auth login
gh auth setup-git
```

`gh auth setup-git` can configure Git to use GitHub CLI for HTTPS credentials. For SSH remotes, make sure an SSH key is configured with GitHub.

Never paste a personal access token into `.git/config`, commit credentials, or share terminal output containing secrets.

## Safety and limitations

- A plain `fix-your-git` run is read-only. Only `--fix` changes anything, and only these three
  global settings: `user.name`, `user.email`, and `gh auth setup-git`. It shows each command
  and runs it only when you type `y`. It never touches remotes, branches, or files, and
  refuses to run without an interactive terminal.
- It does not attempt a network push, so it cannot prove that GitHub will accept one.
- A configured remote does not prove that the user has write permission.
- A successful `gh auth status` does not guarantee that Git itself is using the same credentials, particularly with SSH remotes.
- Review every suggested command before running it. Replace placeholder values such as `USERNAME` and `REPOSITORY`.

## Releasing

Bump `version` in `package.json` through a normal pull request. Once it is merged, tag that
commit on `main` and push the tag:

```bash
git checkout main && git pull
git tag v0.1.1
git push origin v0.1.1
```

The Release workflow checks that the tag matches `package.json` and publishes to npm through
trusted publishing, so no npm token is stored in GitHub. It also refuses a tag that points at
a commit not on `main`.

Trusted publishing can only be configured once the package exists on npm, so version 0.1.0
was published by hand with `npm publish`. The package's settings on npmjs.com then got a
trusted publisher: GitHub Actions, repository `thedevlabs-io/fix-your-git`, workflow
`release.yml`, environment `npm`.
