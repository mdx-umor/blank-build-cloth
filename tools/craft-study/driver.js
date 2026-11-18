// Drives Craft Anything's MCP server through one session, so a browser it opens stays open across calls.
// Usage: node tools/craft-study/driver.js <steps.js> <output-folder> [--deep]
// <steps.js> exports async (call, save) => { ... } and uses call(toolName, args) for each step.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const [stepsFile, outDir, ...flags] = process.argv.slice(2);
if (!stepsFile || !outDir) { console.error('usage: driver.js <steps.js> <output-folder> [--deep]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const project = path.resolve(__dirname, '../../.craft/design-master.cany');
const args = ['--allow-run', ...(flags.includes('--deep') ? ['--deep'] : []), '--project', project, 'mcp', '--all-tools'];
const srv = spawn('craft-anything-cli', args, { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', id = 0;
const pending = new Map();
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
srv.stderr.on('data', (d) => fs.appendFileSync(path.join(outDir, 'server-stderr.log'), d));
const rpc = (method, params, ms = 600000) => new Promise((res, rej) => {
  const n = ++id; pending.set(n, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  setTimeout(() => { if (pending.has(n)) { pending.delete(n); rej(new Error(`timeout: ${method} ${params?.name || ''}`)); } }, ms);
});
let step = 0;
async function call(name, a = {}, ms) {
  step++;
  const t0 = Date.now();
  const r = await rpc('tools/call', { name, arguments: a }, ms);
  const res = r.error ? { error: r.error } : r.result;
  const file = path.join(outDir, `${String(step).padStart(2, '0')}-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(res, null, 2));
  const text = (res.content || []).map((c) => c.text || '').join('\n');
  const isErr = !!(res.error || res.isError);
  console.log(`${isErr ? 'ERR ' : 'ok  '} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s) → ${path.basename(file)}${isErr ? '\n    ' + (res.error ? JSON.stringify(res.error) : text.slice(0, 600)) : ''}`);
  let parsed = null;
  try { parsed = res.structuredContent || JSON.parse(text); } catch { parsed = null; }
  return { ok: !isErr, text, data: parsed, raw: res };
}
const save = (name, content) => fs.writeFileSync(path.join(outDir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
(async () => {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'design-master-study', version: '1' } }, 60000);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await require(path.resolve(stepsFile))(call, save);
  srv.kill();
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e.message); srv.kill(); process.exit(1); });
