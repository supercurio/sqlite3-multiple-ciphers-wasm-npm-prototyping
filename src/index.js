#!/usr/bin/env node
import https from 'https';
import http from 'http';
import fs from 'fs-extra';
import path from 'path';
import extract from 'extract-zip';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { URL } from 'url';

// Get current directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fetchLatestRelease(owner, repo) {
  return new Promise((resolve, reject) => {
    // Use GitHub token if available in environment variables
    const token = process.env.GITHUB_TOKEN;
    const headers = {
      'User-Agent': 'Node.js GitHub Release Fetcher'
    };
    
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }
    
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases/latest`,
      headers
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        } else if (res.statusCode === 403 && res.headers['x-ratelimit-remaining'] === '0') {
          reject(new Error('GitHub API rate limit exceeded. Use GITHUB_TOKEN environment variable to increase the limit.'));
        } else {
          try {
            const errorData = JSON.parse(data);
            reject(new Error(`API request failed with status code ${res.statusCode}: ${errorData.message}`));
          } catch (e) {
            reject(new Error(`API request failed with status code ${res.statusCode}`));
          }
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });
  });
}

async function downloadFile(url, targetPath) {
  return new Promise((resolve, reject) => {
    const handleResponse = (response) => {
      // Handle redirects (status codes 301, 302, 307, 308)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`Redirecting to: ${response.headers.location}`);
        const redirectUrl = new URL(response.headers.location);
        
        // Create a new request based on the protocol of the redirect URL
        const requestFn = redirectUrl.protocol === 'https:' ? https.get : http.get;
        requestFn(response.headers.location, handleResponse)
          .on('error', (error) => {
            fs.unlink(targetPath, () => {});
            reject(new Error(`Redirect request failed: ${error.message}`));
          });
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download file: ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(targetPath);
      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`Download completed: ${targetPath}`);
        resolve();
      });
      
      file.on('error', (error) => {
        fs.unlink(targetPath, () => {});
        reject(new Error(`File write error: ${error.message}`));
      });
    };

    // Initial request
    const requestFn = url.startsWith('https:') ? https.get : http.get;
    requestFn(url, handleResponse)
      .on('error', (error) => {
        fs.unlink(targetPath, () => {});
        reject(new Error(`Download error: ${error.message}`));
      });
  });
}

async function extractWasmFiles(zipPath, destinationPath) {
  try {
    // Create a temporary directory for initial extraction
    const tempDir = path.join(path.dirname(destinationPath), 'temp-extract');
    await fs.ensureDir(tempDir);
    
    // Extract the zip file to the temporary directory
    await extract(zipPath, { dir: path.resolve(tempDir) });
    
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
