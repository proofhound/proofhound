# Release Process

ProofHound uses one manual GitHub Actions workflow, `.github/workflows/release.yml`, for the full release path. The workflow keeps the release version, `CHANGELOG.md`, all publishable `@proofhound/*` package versions, npm publication, and the GitHub Release tied to the same version.

When you need to prepare a release, manually run the `release` workflow with `mode=prepare`. It runs release-please and creates or updates the Release PR. Commit messages follow Conventional Commits: `fix:` produces a patch, `feat:` produces a patch during the `0.x` phase, and `!` or `BREAKING CHANGE` produces a minor during the `0.x` phase.

After the Release PR is merged, run the same `release` workflow with `mode=dry_run`. The workflow resolves the canonical release version from the publishable `@proofhound/*` packages, optionally checks it against the `version` input if provided, verifies that the root package, release-please manifest, and `CHANGELOG.md` share that version, then runs the release build and tarball consumer checks without publishing.

After the dry run is green, run the same `release` workflow with `mode=publish` and the desired `dist_tag`. The publish job resolves the same canonical release version, repeats the release-state checks, verifies the npm version is unpublished, publishes the packed packages, runs the registry consumer test, and then creates GitHub Release `v<version>` from the generated release notes.

The release workflow must run from `master`. The current workflow uses the default `GITHUB_TOKEN`; if Release PRs created by release-please need to trigger other GitHub Actions workflows, configure a dedicated PAT secret for the action.
