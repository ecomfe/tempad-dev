import { readdirSync, existsSync, mkdirSync, lstatSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pluginsDir = resolve(__dirname, 'src');
const distDir = resolve(__dirname, 'dist');

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

const pluginEntries = readdirSync(pluginsDir)
  .filter(name => lstatSync(join(pluginsDir, name)).isDirectory())
  .map(name => ({
    name,
    entry: join(pluginsDir, name, 'index.ts'),
    output: join(distDir, `${name}.js`)
  }));

async function build() {
  try {
    await Promise.all(pluginEntries.map(async ({ entry, output }) => {
      try {
        await esbuild.build({
          entryPoints: [entry],
          outfile: output,
          bundle: true,
          minify: true,
          format: 'esm',
          target: 'esnext',
          sourcemap: false
        });
        console.log(`Built ${output}`);
      } catch (error) {
        console.error(`Failed to build ${output}:`, error);
      }
    }));
    console.log('All plugins built successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// 执行构建
build();
