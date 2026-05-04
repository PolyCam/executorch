#!/usr/bin/env bash
# Polycam wrapper around scripts/build_android_library.sh.
# Produces dist/android/executorch.aar with Vulkan + NEON + etdump.
set -euo pipefail

PLATFORM="${1:-android}"
if [[ "${PLATFORM}" != "android" ]]; then
  echo "Error: only 'android' is supported (got '${PLATFORM}')" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

if [[ -z "${PYTHON_EXECUTABLE:-}" ]]; then
  PYTHON_EXECUTABLE="$(command -v python3)"
fi
export PYTHON_EXECUTABLE

if [[ -z "${ANDROID_NDK:-}" ]] && [[ -d "${HOME}/Library/Android/sdk/ndk" ]]; then
  ANDROID_NDK="$(/bin/ls -d "${HOME}/Library/Android/sdk/ndk"/* 2>/dev/null | sort -V | tail -n1)"
fi
if [[ -z "${ANDROID_HOME:-}" ]] && [[ -d "${HOME}/Library/Android/sdk" ]]; then
  ANDROID_HOME="${HOME}/Library/Android/sdk"
fi
ANDROID_SDK="${ANDROID_SDK:-${ANDROID_HOME:-}}"
export ANDROID_NDK ANDROID_HOME ANDROID_SDK

export EXECUTORCH_BUILD_VULKAN="${EXECUTORCH_BUILD_VULKAN:-ON}"
export EXECUTORCH_ANDROID_PROFILING="${EXECUTORCH_ANDROID_PROFILING:-ON}"
export ANDROID_ABIS="${ANDROID_ABIS:-arm64-v8a}"
export BUILD_AAR_DIR="${BUILD_AAR_DIR:-${REPO_ROOT}/aar-out}"

git submodule update --init --recursive

mkdir -p "${BUILD_AAR_DIR}"

# Inject -DPYTHON_EXECUTABLE into upstream's cmake invocation without
# modifying the tracked script. cmake's find_package(Python3) ignores
# the PYTHON_EXECUTABLE env var — it has to land on the cmake command
# line. Patch via sed into a tempfile so the upstream script stays clean.
PATCHED_SCRIPT="$(mktemp -t build_android_library.XXXXXX.sh)"
trap 'rm -f "${PATCHED_SCRIPT}"' EXIT
sed 's|-DCMAKE_TOOLCHAIN_FILE=|-DPYTHON_EXECUTABLE="${PYTHON_EXECUTABLE}" -DCMAKE_TOOLCHAIN_FILE=|' \
  scripts/build_android_library.sh > "${PATCHED_SCRIPT}"
chmod +x "${PATCHED_SCRIPT}"

bash "${PATCHED_SCRIPT}"

DIST_DIR="${REPO_ROOT}/dist/android"
mkdir -p "${DIST_DIR}"
cp "${BUILD_AAR_DIR}/executorch.aar" "${DIST_DIR}/executorch.aar"

echo "-> Wrote ${DIST_DIR}/executorch.aar"
