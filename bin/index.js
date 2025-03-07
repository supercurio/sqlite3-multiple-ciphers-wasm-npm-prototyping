#!/usr/bin/env node
import fetch from 'node-fetch';
import fs from 'fs';
import decompress from 'decompress';

async function fetchLatestRelease(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  let headers = {};
  // Use GITHUB_TOKEN if available to avoid rate limiting
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    throw new Error(`Network request failed: ${error.message}`);
  }

  if (response.ok) {
    return response.json();
  }

  if (response.status === 403 &&
    response.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error('GitHub API rate limit exceeded. ' +
      'Use GITHUB_TOKEN environment variable to increase the limit.');
  }

  const errorData = await response.json().catch(() => ({}));
  throw new Error(`API request failed with status code ${response.status}:
     ${errorData.message || 'Unknown error'}`);
}

async function downloadAndUnzipSqliteWasm(sqliteWasmDownloadLink) {
  if (!sqliteWasmDownloadLink) {
    throw new Error('Unable to find SQLite Wasm download link');
  }
  console.log('Downloading and unzipping SQLite Wasm...');
  const response = await fetch(sqliteWasmDownloadLink);
  if (!response.ok || response.status !== 200) {
    throw new Error(
      `Unable to download SQLite Wasm from ${sqliteWasmDownloadLink}`,
    );
  }
  const buffer = await response.arrayBuffer();
  fs.writeFileSync('sqlite-wasm.zip', Buffer.from(buffer));
  const files = await decompress('sqlite-wasm.zip', 'sqlite-wasm', {
    strip: 1,
    filter: (file) =>
      /jswasm/.test(file.path) && /(\.mjs|\.wasm|\.js)$/.test(file.path),
  });
  console.log(
    `Downloaded and unzipped:\n${files
      .map((file) => (/\//.test(file.path) ? '‣ ' + file.path + '\n' : ''))
      .join('')}`,
  );
  fs.rmSync('sqlite-wasm.zip');
}

function displayReleaseInfo(release) {
  console.log(`\nLatest Release: ${release?.name ?? 'unnamed'}`);
  console.log(`Version: ${release?.tag_name ?? 'untagged'}`);
  console.log(`Published: ${release?.published_at ?
    new Date(release.published_at).toLocaleString() : 'unknown'}`);
  console.log(`\nDescription:\n${release?.body ?? 'No description provided'}`);
}

function displayWasmAssets(asset) {
  console.log('\nWASM Build File:');
  console.log(`- ${asset.name}`);
  console.log(`  Size: ${asset.size ?
    (asset.size / 1024).toFixed(2) + ' KB' : 'unknown'}`);
  console.log(`  Download: ${asset.browser_download_url}\n`);
}

async function main() {
  const owner = 'utelle';
  const repo = 'SQLite3MultipleCiphers';

  console.log(`Fetching latest release information for ${owner}/${repo}...`);
  try {
    const release = await fetchLatestRelease(owner, repo);

    displayReleaseInfo(release);

    // Find WASM assets
    const wasmAssets = release
      ?.assets
      ?.filter(asset => asset.name.endsWith('-wasm.zip')) || [];

    // Check for exactly one WASM asset
    if (wasmAssets.length === 0) {
      throw new Error('No WASM assets found in the latest release.');
    } else if (wasmAssets.length > 1) {
      throw new Error(`Found ${wasmAssets.length} ` +
        'WASM assets in the release. Expected exactly 1.');
    }
    const wasmAsset = wasmAssets[0];
    displayWasmAssets(wasmAsset);

    await downloadAndUnzipSqliteWasm(wasmAsset.browser_download_url);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
