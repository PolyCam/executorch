#!/usr/bin/env node
const { exec, spawn } = require('child_process');
const fs = require('fs/promises');
const { createWriteStream, existsSync } = require('fs');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
const path = require('path');

const DIST_DIR = path.dirname(__dirname);
const PLATFORM = process.argv[2];

const REPO_ROOT = path.join(DIST_DIR, '..');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-polycam-aar.sh');

const PLATFORMS = {
  android: {
    dir: path.join(DIST_DIR, 'android'),
    archive: 'executorch-android.tgz',
    checkPath: 'executorch.aar',
    extractCmd: (archive, dir) => `tar -xzf "${archive}" -C "${dir}"`,
    clean: async (dir) => fs.rm(path.join(dir, 'executorch.aar'), { force: true }),
    buildArgs: ['android'],
  },
};

function isLocalDev() {
  return existsSync(BUILD_SCRIPT);
}

function runBuild(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(BUILD_SCRIPT, args, {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build failed with exit code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

  try {
    const token = await new Promise((resolve, reject) => {
      const proc = spawn('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      proc.stdout.on('data', (data) => stdout += data);
      proc.on('close', (code) => {
        if (code !== 0) return reject(new Error('not authenticated'));
        const lines = stdout.trim().split('\n');
        let tokenLine = lines.find(line => !line.startsWith('Warning:')) || '';
        if (tokenLine.startsWith('go-keyring-base64:')) {
          tokenLine = Buffer.from(tokenLine.slice(18), 'base64').toString('utf8');
        }
        resolve(tokenLine);
      });
      proc.on('error', (err) => reject(err));
    });
    if (token) return token;
  } catch (err) {
    const ghInstalled = await new Promise((resolve) => {
      const proc = spawn('gh', ['--version'], { stdio: 'ignore' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });

    if (!ghInstalled) {
      console.error('Error: GitHub CLI (gh) is not installed.');
      console.error('');
      console.error('To install on macOS:');
      console.error('  brew install gh');
      console.error('');
      console.error('Then authenticate:');
      console.error('  gh auth login');
    } else {
      console.error('Error: GitHub CLI is not authenticated.');
      console.error('');
      console.error('Run the following to authenticate:');
      console.error('  gh auth login');
    }
    process.exit(1);
  }

  return null;
}

async function getAssetUrl(repo, version, assetName, token) {
  const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/v${version}`;
  const response = await fetch(apiUrl, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ensure-native',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get release info: ${apiUrl} (${response.status})`);
  }

  const data = await response.json();
  const asset = data.assets?.find(a => a.name === assetName);
  if (!asset) {
    throw new Error(`Asset '${assetName}' not found in release v${version}`);
  }
  return asset.url;
}

async function download(url, dest, token) {
  const response = await fetch(url, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/octet-stream',
      'User-Agent': 'ensure-native',
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${url} (${response.status})`);
  }

  const fileStream = createWriteStream(dest);
  await finished(Readable.fromWeb(response.body).pipe(fileStream));
}

async function readManifest(manifestPath) {
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(content).version;
  } catch {
    return null;
  }
}

async function readPackageVersion(pkgPath) {
  try {
    const content = await fs.readFile(pkgPath, 'utf8');
    return JSON.parse(content).version;
  } catch {
    return null;
  }
}

async function main() {
  if (!PLATFORM) {
    console.error('Usage: ensure-native <android>');
    process.exit(1);
  }

  const config = PLATFORMS[PLATFORM];
  if (!config) {
    console.error(`Error: Unknown platform: ${PLATFORM} (expected android)`);
    process.exit(1);
  }

  const manifestPath = path.join(config.dir, '.manifest.json');
  const checkPath = path.join(config.dir, config.checkPath);
  const pkgPath = path.join(DIST_DIR, '..', 'package.json');

  const expectedVersion = process.env.EXECUTORCH_VERSION || await readPackageVersion(pkgPath);
  if (!expectedVersion) {
    console.error('Error: Could not determine version');
    process.exit(1);
  }

  const repo = process.env.EXECUTORCH_REPO || 'PolyCam/executorch';

  console.log(`@poly/executorch ${PLATFORM} binary setup (v${expectedVersion})`);

  const currentVersion = await readManifest(manifestPath);

  if (existsSync(checkPath)) {
    if (currentVersion === expectedVersion) {
      console.log('-> Already installed');
      process.exit(0);
    }
    if (currentVersion === 'local') {
      console.log('-> Using local build');
      process.exit(0);
    }
  }

  if (currentVersion && currentVersion !== 'local') {
    console.log(`-> Upgrading: ${currentVersion} -> ${expectedVersion}`);
  }

  if (isLocalDev()) {
    console.log('-> Building locally...');
    try {
      await runBuild(config.buildArgs);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }

    if (!existsSync(checkPath)) {
      console.error('Error: Build did not produce expected output');
      process.exit(1);
    }

    console.log('-> Built');
    process.exit(0);
  }

  console.log('-> Downloading from GitHub...');
  const token = await getGitHubToken();

  await fs.rm(manifestPath, { force: true });
  await config.clean(config.dir);
  await fs.mkdir(config.dir, { recursive: true });

  const archivePath = path.join(config.dir, config.archive);

  try {
    const assetUrl = await getAssetUrl(repo, expectedVersion, config.archive, token);
    await download(assetUrl, archivePath, token);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  console.log('-> Extracting...');
  try {
    await execAsync(config.extractCmd(archivePath, config.dir));
    await fs.unlink(archivePath);
  } catch (err) {
    console.error(`Error: Extract failed - ${err.message}`);
    process.exit(1);
  }

  if (!existsSync(checkPath)) {
    console.error('Error: Extract failed');
    process.exit(1);
  }

  await fs.writeFile(manifestPath, JSON.stringify({ version: expectedVersion, source: 'github' }));
  console.log('-> Installed');
}

main();
