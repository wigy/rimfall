// Regenerates the README level catalog images: one gameplay screenshot per web
// shape, plus a thumbnail of each.
//
//   node scripts/capture-levels.mjs [outDir]    (default: docs/screenshots/levels)
//
// Needs Playwright with Chromium (a local or global install) and ImageMagick.
// Playwright is not a project dependency, to keep `npm install` and CI light.
// Enemy placement varies between runs because the game seeds itself from the clock.
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(process.argv[2] ?? join(root, 'docs/screenshots/levels'));
const thumbDir = join(outDir, 'thumbs');
const THUMB_WIDTH = 400;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    return require(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
  }
}

/** Plays through every shape in order and returns the screenshot file names. */
async function capture(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.game);
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.game.mode === 'playing');

  const shapes = await page.evaluate(() => import('/src/game/levels.ts').then((m) => m.SHAPE_COUNT));
  const files = [];
  for (let level = 1; level <= shapes; level++) {
    // Skip the intro and pull the wave forward so enemies are already on the web.
    await page.evaluate((l) => {
      const g = window.game;
      window.setupLevel(g, l);
      g.lives = 3;
      g.levelTime = 1.9; // past LEVEL_INTRO and the level banner
      for (const s of g.spawnQueue) s.at = Math.max(0, s.at - 1.2) * 0.5;
    }, level);

    // Hold fire until enough is on screen, with the player still alive.
    await page.keyboard.down('Space');
    await page.waitForFunction(
      () => {
        const g = window.game;
        return g.mode === 'playing' && g.enemies.length >= 5 && g.enemies.some((e) => e.depth < 0.55);
      },
      undefined,
      { timeout: 15000 },
    );
    await page.keyboard.up('Space');

    const name = await page.evaluate(() => window.game.web.name);
    const file = `${String(level).padStart(2, '0')}-${name.toLowerCase()}.png`;
    await page.screenshot({ path: join(outDir, file) });
    files.push(file);
    console.log(file);
  }
  return files;
}

function makeThumbnails(files) {
  for (const file of files) {
    const thumb = join(thumbDir, file.replace(/\.png$/, '.jpg'));
    execFileSync('convert', [join(outDir, file), '-resize', `${THUMB_WIDTH}x`, '-strip', '-quality', '85', thumb]);
  }
}

const { chromium } = loadPlaywright();
mkdirSync(thumbDir, { recursive: true });

const server = await createServer({ root, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  const files = await capture(page, server.resolvedUrls.local[0]);

  // Drop images of shapes that were renamed or removed.
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.png') && !files.includes(f)) rmSync(join(outDir, f));
  }
  rmSync(thumbDir, { recursive: true });
  mkdirSync(thumbDir);
  makeThumbnails(files);
} finally {
  await browser.close();
  await server.close();
}
