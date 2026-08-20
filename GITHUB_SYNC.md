# GitHub Sync Guide

This document explains how to push code changes from this repository to the GitHub mirror repo.

## GitHub Remote

- **Remote name:** `github`
- **Repo URL:** https://github.com/upjabir-prodapt/aihub-ui.git
- **Target branch on GitHub:** `main`

The remote is already configured with a Personal Access Token (PAT) embedded in the URL, so no additional login/authentication is required when pushing.

To verify the remote is set up correctly:
```bash
git remote -v
```
You should see:
```
github  https://upjabir-prodapt:<PAT>@github.com/upjabir-prodapt/aihub-ui.git (fetch)
github  https://upjabir-prodapt:<PAT>@github.com/upjabir-prodapt/aihub-ui.git (push)
```

## Steps to Push Code Changes to GitHub

1. **Stage your changes:**
   ```bash
   git add .
   ```

2. **Commit with a message:**
   ```bash
   git commit -m "your commit message"
   ```

3. **Push to GitHub:**
   ```bash
   git push github <your-branch-name>:main
   ```

   Example (pushing from the `iap-wif-refactor` branch):
   ```bash
   git push github iap-wif-refactor:main
   ```

   Or, to push whichever branch you currently have checked out (without typing its name):
   ```bash
   git push github HEAD:main
   ```

## Changing the Target GitHub Branch

By default, all pushes above go to the `main` branch on GitHub. If you want to push to a **different branch** on GitHub instead of `main`, simply change the part after the colon (`:`) in the push command.

Syntax:
```bash
git push github <your-local-branch>:<github-target-branch>
```

Example — push local branch `iap-wif-refactor` to a GitHub branch called `develop` instead of `main`:
```bash
git push github iap-wif-refactor:develop
```

Example — push local branch `feature/new-ui` to a new GitHub branch called `feature/new-ui` (creates it if it doesn't exist):
```bash
git push github feature/new-ui:feature/new-ui
```

## Notes

- The PAT embedded in the remote URL grants write access to the repo — treat it like a password. Do not share this repo's `.git/config` file or expose the PAT publicly.
- If the PAT expires or is revoked, regenerate a new one on GitHub (Settings → Developer settings → Personal access tokens) and update the remote:
  ```bash
  git remote set-url github https://upjabir-prodapt:<NEW_PAT>@github.com/upjabir-prodapt/aihub-ui.git
  ```
- This `github` remote is separate from `origin` (Azure DevOps). Pushing to `github` does NOT affect the `origin`/Azure DevOps remote, and vice versa.
