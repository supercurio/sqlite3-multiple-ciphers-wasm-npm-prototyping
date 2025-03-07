#!/usr/bin/env node
import fetch from 'node-fetch';
import fs from 'fs-extra';
import path from 'path';
import decompress from 'decompress';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';

// Get current directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function downloadFile(url, targetPath) {
  try {
    let response = await fetch(url);

    // Handle redirects manually if needed
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      console.log(`Redirecting to: ${response.headers.get('location')}`);
      response = await fetch(response.headers.get('location'));
    }

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }

    const stream = fs.createWriteStream(targetPath);

    await new Promise((resolve, reject) => {
      const body = response.body;
      body.pipe(stream);

      body.on('error', (err) => {
        fs.unlink(targetPath, () => { });
        reject(new Error(`File write error: ${err.message}`));
      });

      stream.on('finish', () => {
        console.log(`Download completed: ${targetPath}`);
        resolve();
      });
    });
  } catch (error) {
    await fs.unlink(targetPath).catch(() => { });
    throw new Error(`Download error: ${error.message}`);
  }
}

async function extractWasmFiles(zipPath, destinationPath) {
  try {
    // Create a temporary directory for initial extraction
    const tempDir = path.join(path.dirname(destinationPath), 'temp-extract');
    await fs.ensureDir(tempDir);

    // Extract the zip file to the temporary directory using decompress
    await decompress(zipPath, tempDir);
    
    // Find the jswasm directory in the extracted files
    const jswasmPath = await findJswasmDirectory(tempDir);

    if (jswasmPath) {
      console.log(`Found jswasm directory: ${jswasmPath}`);

      // Create the jswasm directory in the destination
      const jswasmDestDir = path.join(destinationPath, 'jswasm');
      await fs.ensureDir(jswasmDestDir);

      // Copy all files from jswasm directory to the destination jswasm directory
      const files = await fs.readdir(jswasmPath);
      for (const file of files) {
        const sourcePath = path.join(jswasmPath, file);
        const targetPath = path.join(jswasmDestDir, file);

        // Copy the file
        await fs.copy(sourcePath, targetPath);
        console.log(`Copied: ${file} to ${targetPath}`);
      }

      // Clean up the temporary directory
      await fs.remove(tempDir);
      console.log(`Cleaned up temporary directory: ${tempDir}`);

      return true;
    } else {
      console.error('Could not find jswasm directory in the extracted files');
      // Clean up the temporary directory
      await fs.remove(tempDir);
      return false;
    }
  } catch (error) {
    console.error(`Extraction failed: ${error.message}`);
    return false;
  }
}

async function findJswasmDirectory(dir) {
  // Try to find the jswasm directory recursively
  const items = await fs.readdir(dir, { withFileTypes: true });

  // First, check if we have a jswasm directory directly
  const jswasmDir = items.find(item => item.isDirectory() && item.name === 'jswasm');
  if (jswasmDir) {
    return path.join(dir, 'jswasm');
  }

  // If not, recursively check subdirectories
  for (const item of items) {
    if (item.isDirectory()) {
      const subDirPath = path.join(dir, item.name);
      const result = await findJswasmDirectory(subDirPath);
      if (result) {
        return result;
      }
    }
  }

  return null;
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

        // Create base directory (outside of src directory)
        const baseDir = path.resolve(path.join(__dirname, '..'));
        const zipPath = path.join(baseDir, selectedAsset.name);
        const extractDir = path.join(baseDir, 'sqlite-wasm');

        console.log(`\nDownloading ${selectedAsset.name}...`);
        await downloadFile(downloadUrl, zipPath);

        console.log(`\nExtracting to 'sqlite-wasm' directory...`);
        const extractResult = await extractWasmFiles(zipPath, extractDir);

        if (extractResult) {
          console.log(`\nSuccessfully downloaded and extracted the WASM build to: ${extractDir}`);
        } else {
          console.error('\nExtraction failed. The zip file may be corrupted or incompatible.');
        }
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
