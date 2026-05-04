# Polycam Local AAR Iteration

This fork ships an Android AAR (Vulkan + NEON + etdump) as the
`@poly/executorch` npm package. CI builds the AAR, attaches it to a
GitHub Release, and publishes the package to the GCP npm registry. The
polycam Android repo `yarn install`s the package and resolves the AAR
on demand via a Gradle pre-build task.

## Iterating on the AAR locally

To test in-progress changes against the polycam Android app without
publishing a new release:

1. From the executorch checkout, register the package globally:
   ```sh
   cd ~/executorch
   yarn link
   ```

2. From the polycam repo, link the package:
   ```sh
   cd ~/polycam
   yarn link @poly/executorch
   ```

3. Build and run the Android app as normal (e.g.
   `cd poly/android && ./gradlew assembleDevDebug`). The Gradle
   `ensureExecutorch` task detects the yarn-linked checkout (because
   `~/executorch/scripts/build-polycam-aar.sh` exists at the repo root)
   and rebuilds the AAR from your local source instead of downloading
   from GitHub Releases.

4. To revert to the published AAR:
   ```sh
   cd ~/polycam
   yarn unlink @poly/executorch
   yarn install --force
   ```

### Building the AAR by hand

```sh
cd ~/executorch
bash scripts/build-polycam-aar.sh android
```

Produces `dist/android/executorch.aar`. Knobs (with defaults):

- `EXECUTORCH_BUILD_VULKAN=ON`
- `EXECUTORCH_ANDROID_PROFILING=ON` — enables `Module.etdump(String)`
- `ANDROID_ABIS=arm64-v8a`
- `BUILD_AAR_DIR=$REPO/aar-out`
- `PYTHON_EXECUTABLE` — required to point at a venv with `torch`
  installed (e.g. `/Users/polycam/polyml/polydepth/.venv/bin/python3`).
  Falls back to `python3` from `PATH`.
- `ANDROID_NDK`, `ANDROID_HOME`, `ANDROID_SDK` — auto-discovered from
  `~/Library/Android/sdk` if unset.

The wrapper runs `git submodule update --init --recursive` for XNNPACK,
cpuinfo, and pthreadpool before invoking cmake.

## Releasing a new AAR version

1. From the `polycam` branch on `PolyCam/executorch`, push your
   commits.
2. In the GitHub UI: **Actions → cd → Run workflow** → enter version
   (e.g. `0.2.0` for a stable release, `0.2.0-rc.1` for pre-release —
   anything that doesn't match `MAJOR.MINOR.PATCH` is published as a
   GitHub pre-release).
3. The workflow:
   - builds `executorch-android.tgz` on the macOS self-hosted runner,
   - creates a `v<version>` GitHub Release with the tgz attached,
   - publishes `@poly/executorch@<version>` to the GCP npm registry
     at `us-central1-npm.pkg.dev/polycam-shared-infra-prod/npm/`.
4. In the polycam Android repo, bump `"@poly/executorch"` in
   `package.json` and run `yarn install`.

## How `ensure-native` resolves the AAR

`node_modules/@poly/executorch/dist/bin/ensure-native.js` runs at the
start of every Gradle build:

1. Reads the expected version from
   `node_modules/@poly/executorch/package.json`.
2. If `dist/android/.manifest.json` already records that version,
   exits immediately (`-> Already installed`).
3. If the package was `yarn link`ed (i.e.
   `<package>/scripts/build-polycam-aar.sh` exists), runs that script
   to rebuild the AAR from the local checkout
   (`-> Building locally...`). The manifest is then stamped `local` so
   subsequent runs short-circuit.
4. Otherwise, fetches the matching GitHub Release asset
   `executorch-android.tgz`, extracts it to `dist/android/`, and writes
   the manifest. Auth comes from `gh auth token` (or
   `GITHUB_TOKEN`/`GH_TOKEN` env).

## Environment overrides

The `ensure-native` script honors a couple of optional env vars when
testing alternate releases:

- `EXECUTORCH_VERSION` — pin the version to fetch from GitHub Releases
  (overrides the value read from `package.json`).
- `EXECUTORCH_REPO` — fetch from a different fork, e.g.
  `EXECUTORCH_REPO=youruser/executorch`. Defaults to `PolyCam/executorch`.
- `GITHUB_TOKEN` / `GH_TOKEN` — bypass `gh auth token` discovery.

## One-time CI configuration

`PolyCam/executorch` repo settings need the **`ARTIFACT_REGISTRY_KEY`**
secret — copy the base64-encoded GCP service-account key value from
the corresponding `PolyCam/polycpp` secret (Settings → Secrets and
variables → Actions). Same SA, no new IAM. The value is not
retrievable via `gh secret list`; pull it from your local 1Password /
shared secret store and set it with
`gh secret set ARTIFACT_REGISTRY_KEY -R PolyCam/executorch`.

Python + torch are provisioned per-run by the CD workflow itself via
`astral-sh/setup-uv` + `bash install_requirements.sh`, so the
self-hosted runner does not need a pre-installed venv.
