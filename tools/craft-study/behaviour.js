// Behaviour study of the reference app: import pictures, open each image tool and export, record what it shows and
// produces (dialogs, options, downloads). Observes the running app only; its code is not read.
// Usage: node tools/craft-study/behaviour.js <files-folder> <output-folder>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [FILES, OUT] = process.argv.slice(2).map((p) => path.resolve(p));
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const note = (s) => { log.push(s); console.log(s); };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('download', async (d) => { const f = path.join(OUT, 'dl-' + d.suggestedFilename()); note('DOWNLOAD ' + d.suggestedFilename()); await d.saveAs(f).catch((e) => note('  save failed ' + e.message)); });
  p.on('dialog', (d) => { note(`JSDIALOG ${d.type()}: ${d.message()}`); d.dismiss(); });
  p.on('console', (m) => { if (m.type() === 'error') note('CONSOLE ' + m.text().slice(0, 200)); });
  await p.goto('https://blankbuilder.app/app/', { waitUntil: 'load', timeout: 90000 });
  await p.waitForTimeout(12000);
  const clean = () => p.evaluate(() => { document.querySelectorAll('.tour, [aria-label="Cookie settings"]').forEach((e) => e.remove()); }).catch(() => {});
  await p.getByText('Decline', { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  await clean();
  let n = 0;
  const snap = async (name) => {
    await p.waitForTimeout(1200); await clean();
    const f = `${String(++n).padStart(2, '0')}-${name}`;
    await p.screenshot({ path: path.join(OUT, f + '.png') });
    fs.writeFileSync(path.join(OUT, f + '.aria.txt'), await p.locator('body').ariaSnapshot().catch(() => ''));
    note('SNAP ' + f);
  };
  const clickText = (t, sel = 'button,[role=button],[role=menuitem],[role=option],label') => p.evaluate(([t, sel]) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.offsetParent && (x.innerText || x.getAttribute('aria-label') || '').trim().startsWith(t));
    if (!e) return false; e.click(); return true;
  }, [t, sel]);
  const esc = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(400); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { note(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };

  // inputs the page offers for pictures
  const inputs = await p.evaluate(() => [...document.querySelectorAll('input[type=file]')].map((i) => ({ id: i.id, accept: i.accept, multiple: i.multiple })));
  note('FILE INPUTS ' + JSON.stringify(inputs));
  const layerCount = () => p.evaluate(() => document.querySelectorAll('[aria-label="Drag to change the layer order"], li[title="Drag to change the layer order"]').length);
  note('layers at start: ' + await layerCount());

  for (const file of ['logo.png', 'logo.svg', 'badge.pdf']) {
    await step('import ' + file, async () => {
      const before = await layerCount();
      const input = p.locator('input[type=file]').first();
      await input.setInputFiles(path.join(FILES, file));
      await p.waitForTimeout(6000);
      note(`import ${file}: layers ${before} → ${await layerCount()}`);
      await snap('import-' + file.replace('.', '-'));
    });
  }
  // the last picture is selected: open each image tool
  await step('crop', async () => { note('crop: ' + await clickText('Crop')); await snap('crop'); await esc(); });
  await step('halftone', async () => { note('halftone: ' + await clickText('Halftone')); await snap('halftone'); await esc(); await esc(); });
  await step('wrap', async () => { note('wrap: ' + await clickText('Wrap over seams')); await snap('wrap'); await esc(); });
  // exports
  const more = (label) => step('export ' + label, async () => {
    await p.evaluate(() => document.querySelector('#bExportMore')?.click()); await p.waitForTimeout(600);
    note(`export ${label}: ` + await clickText(label, '[role=menuitem],button'));
    await p.waitForTimeout(4000);
    await snap('export-' + label.replace(/\W+/g, '-').toLowerCase());
    for (const t of ['Download ZIP', 'Download PDF', 'Export anyway', 'Start']) {
      if (await clickText(t)) { note(`  clicked ${t}`); await p.waitForTimeout(15000); await snap('after-' + t.replace(/\W+/g, '-').toLowerCase()); }
    }
    await esc(); await esc();
  });
  await more('Print files');
  await more('Spec sheet');
  await more('Sublimation panels');
  await more('Turntable video');
  await step('snapshot', async () => { await p.evaluate(() => document.querySelector('#bShot')?.click()); await p.waitForTimeout(8000); await snap('after-snapshot'); await esc(); });
  await step('export main', async () => { await p.evaluate(() => document.querySelector('#bExportMain')?.click()); await p.waitForTimeout(4000); await snap('render-dialog'); await esc(); });
  fs.writeFileSync(path.join(OUT, 'log.txt'), log.join('\n'));
  await b.close();
})();
