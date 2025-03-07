#!/usr/bin/env node
import fetch from 'node-fetch';
import fs from 'fs-extra';
import decompress from 'decompress';

function fetchLatestRelease(owner, repo) {
  return new Promise(async (resolve, reject) => {
    // Use GitHub token if available in environment variables
    const token = process.env.GITHUB_TOKEN;
    const headers = {
      'User-Agent': 'Node.js GitHub Release Fetcher'
    };

    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

    try {
      const response = await fetch(url, { headers });

      if (response.status === 200) {
        const data = await response.json();
        resolve(data);
      } else if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        reject(new Error('GitHub API rate limit exceeded. Use GITHUB_TOKEN environment variable to increase the limit.'));
      } else {
        const errorData = await response.json().catch(() => ({}));
        reject(new Error(`API request failed with status code ${response.status}: ${errorData.message || 'Unknown error'}`));
      }
    } catch (error) {
      reject(new Error(`Request failed: ${error.message}`));
    }
  });
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

async function main() {
  try {
    const owner = 'utelle';
    const repo = 'SQLite3MultipleCiphers';

    console.log(`Fetching latest release information for ${owner}/${repo}...`);

    const release = await fetchLatestRelease(owner, repo);

    console.log(`\nLatest Release: ${release.name || 'unnamed'}`);
    console.log(`Version: ${release.tag_name || 'untagged'}`);
    console.log(`Published: ${release.published_at ? new Date(release.published_at).toLocaleString() : 'unknown'}`);
    console.log(`\nDescription: ${release.body || 'No description provided'}`);

    console.log('\nWASM Build Files:');
    if (release.assets && release.assets.length > 0) {
      const wasmAssets = release.assets.filter(asset => asset.name.endsWith('-wasm.zip'));

      if (wasmAssets.length > 0) {
        wasmAssets.forEach(asset => {
          console.log(`- ${asset.name}`);
          console.log(`  Size: ${asset.size ? (asset.size / 1024).toFixed(2) + ' KB' : 'unknown'}`);
          console.log(`  Download: ${asset.browser_download_url}`);
        });

        // Select the first WASM asset for download
        const selectedAsset = wasmAssets[0];
        const downloadUrl = selectedAsset.browser_download_url;

        await downloadAndUnzipSqliteWasm(downloadUrl);

      } else {
        console.log('No WASM build files found in this release.');
      }
    } else {
      console.log('No assets found for this release.');
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
