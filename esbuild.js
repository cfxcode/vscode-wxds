const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const testBuild = process.argv.includes('--test');

async function main() {
  if (testBuild) {
    await esbuild.build({
      entryPoints: ['test/core.test.ts'],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile: 'dist-test/core.test.cjs',
      logLevel: 'info',
    });
    return;
  }

  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: !watch,
    sourcemap: watch,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  if (watch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
