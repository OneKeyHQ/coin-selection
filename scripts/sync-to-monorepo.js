/* eslint-disable @typescript-eslint/no-var-requires */
require('dotenv').config();
const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

// Configuration
const config = {
  // Path to app-monorepo, read from environment variable
  targetDir: process.env.APP_MONOREPO_LOCAL_PATH,
  // Current package name
  packageName: '@onekeyfe/cardano-coin-selection-asmjs',
  // Source directory to watch
  watchDir: 'src',
  // Build output directory
  buildDir: 'lib',
  // Debounce time in milliseconds
  debounceTime: 300,
  // Apps whose caches need to be cleared
  appCacheDirs: ['desktop', 'ext', 'web', 'mobile'],
};

if (!config.targetDir) {
  console.error(
    '❌ APP_MONOREPO_LOCAL_PATH is not set. Please specify it in the .env file.\n' +
      'Example: APP_MONOREPO_LOCAL_PATH=/path/to/app-monorepo'
  );
  process.exit(1);
}

const projectRoot = __dirname;
const destNodeModulesPath = path.join(
  config.targetDir,
  'node_modules',
  config.packageName
);

console.log('📦 Package:', config.packageName);
console.log('📂 Source:', path.join(projectRoot, config.watchDir));
console.log('📁 Target:', destNodeModulesPath);
console.log('');

// Debounced build state
let buildTimeout = null;
let isBuilding = false;

function triggerBuild() {
  if (buildTimeout) {
    clearTimeout(buildTimeout);
  }

  buildTimeout = setTimeout(() => {
    if (isBuilding) {
      console.log('⏳ Build already in progress, queuing...');
      triggerBuild();
      return;
    }

    isBuilding = true;
    console.log('\n🔨 Building...');

    exec('yarn build', { cwd: projectRoot }, (error, stdout, stderr) => {
      isBuilding = false;

      if (error) {
        console.error('❌ Build failed:', error.message);
        if (stderr) console.error(stderr);
        return;
      }

      console.log('✅ Build complete');
      syncBuildOutput();
    });
  }, config.debounceTime);
}

async function clearAppCaches() {
  const clearedApps = [];

  for (const app of config.appCacheDirs) {
    const cachePath = path.join(config.targetDir, 'apps', app, 'node_modules', '.cache');
    if (await fs.pathExists(cachePath)) {
      await fs.remove(cachePath);
      clearedApps.push(app);
    }
  }

  if (clearedApps.length > 0) {
    console.log(`🧹 Cleared cache for: ${clearedApps.join(', ')}`);
  }
}

async function syncBuildOutput() {
  const srcLibPath = path.join(projectRoot, config.buildDir);
  const destLibPath = path.join(destNodeModulesPath, config.buildDir);

  try {
    // Sync the entire lib directory
    await fs.copy(srcLibPath, destLibPath, { overwrite: true });
    console.log(`📤 Synced ${config.buildDir}/ -> ${destLibPath}`);

    // Sync package.json (in case version or other fields changed)
    const srcPackageJson = path.join(projectRoot, 'package.json');
    const destPackageJson = path.join(destNodeModulesPath, 'package.json');
    await fs.copy(srcPackageJson, destPackageJson, { overwrite: true });
    console.log('📤 Synced package.json');

    // Clear webpack caches for all apps
    await clearAppCaches();

    console.log('✨ Sync complete!\n');
  } catch (err) {
    console.error('❌ Sync error:', err);
  }
}

// Watch for source file changes
const watcher = chokidar.watch(path.join(projectRoot, config.watchDir), {
  ignored: [
    /(^|[\/\\])\./,  // Ignore dotfiles
    /node_modules/,
    /\.test\./,      // Ignore test files
    /\.spec\./,
  ],
  persistent: true,
  ignoreInitial: true,
});

watcher
  .on('add', filePath => {
    console.log(`➕ Added: ${path.relative(projectRoot, filePath)}`);
    triggerBuild();
  })
  .on('change', filePath => {
    console.log(`✏️  Changed: ${path.relative(projectRoot, filePath)}`);
    triggerBuild();
  })
  .on('unlink', filePath => {
    console.log(`➖ Removed: ${path.relative(projectRoot, filePath)}`);
    triggerBuild();
  })
  .on('error', error => console.error(`Watcher error: ${error}`))
  .on('ready', () => {
    console.log('👀 Watching for changes in src/...');
    console.log('💡 Tip: Press Ctrl+C to stop\n');

    // Run initial build and sync on startup
    console.log('🚀 Initial build and sync...');
    triggerBuild();
  });

process.on('SIGINT', () => {
  console.log('\n👋 Closing watcher...');
  watcher.close();
  console.log('Bye!');
  process.exit(0);
});
