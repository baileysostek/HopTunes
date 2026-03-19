import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import * as fs from 'fs';
import * as path from 'path';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

/**
 * Recursively collect all transitive dependencies of a module.
 */
function getTransitiveDeps(modName: string, nodeModulesDir: string, seen = new Set<string>()): Set<string> {
  if (seen.has(modName)) return seen;
  seen.add(modName);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(nodeModulesDir, modName, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pkg.dependencies || {})) {
      getTransitiveDeps(dep, nodeModulesDir, seen);
    }
  } catch { /* skip unresolvable */ }
  return seen;
}

/** Modules that webpack externalizes and must be copied into the package. */
const externalModules = Object.keys(mainConfig.externals as Record<string, string>);

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/{sqlite3,bindings}/**',
    },
    icon: './resources/icon',
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const srcModules = path.join(__dirname, 'node_modules');
      const destModules = path.join(buildPath, 'node_modules');

      // Collect all transitive deps for every externalized module
      const allDeps = new Set<string>();
      for (const mod of externalModules) {
        getTransitiveDeps(mod, srcModules, allDeps);
      }

      // Copy each dependency into the build's node_modules
      for (const dep of allDeps) {
        const src = path.join(srcModules, dep);
        const dest = path.join(destModules, dep);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      port: 9001,
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/renderer.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
