# SQLite3MultipleCiphers WASM Release Checker
**A** command-line utility that fetches information about the latest release of the SQLite3MultipleCiphers project, focusing on WASM build files.

## Installation
```bash
# Clone this repository
git clone <repository-url>
cd sqlite3-multiple-ciphers-wasm-checker

# Install dependencies 
npm install

# Make the script executable
chmod +x src/index.js
```

## Usage
### Using npm scripts
```bash
# Run with Node.js
npm start
```

### Alternative Runtimes
The tool also supports Deno and Bun:

```bash
# Run with Deno
npm run deno

# Run with Bun
npm run bun
```

### Features
The tool will:
1. Fetch the latest release information from the utelle/SQLite3MultipleCiphers GitHub repository
2. Display release details (version, date, description)
3. List available WASM build files with download links

### Environment Variables
- `GITHUB_TOKEN`: Optional GitHub API token to increase API rate limits

### Direct execution
```bash
# Run directly with Node
node src/index.js

# Installing globally
npm install -g .
sqlite3-multiple-ciphers-wasm-checker
```

## Debugging
For debugging, use:
```bash
npm run debug
```

## System Requirements
- Node.js >= 14.16.0
