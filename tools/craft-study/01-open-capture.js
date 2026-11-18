// Study run 1: open the reference app, capture it, analyse its JavaScript and save its scripts.
const path = require('path');
const OUT = path.resolve(__dirname, '../../.craft/study');
module.exports = async (call, save) => {
  const url = 'https://blankbuilder.app/app/';
  await call('web_site_open', { url, width: 1600, height: 1000, settle_ms: 12000, timeout_secs: 180, headless: true });
  await call('web_site_capture', { output_directory: path.join(OUT, 'capture'), widths: [1600, 390], timeout_secs: 300 });
  await call('web_page_js_analyze', { load_source_maps: true, watch_ms: 4000, timeout_secs: 300, limit: 500 });
  await call('web_modules_trace', { watch_ms: 3000, timeout_secs: 180, limit: 500 });
  const show = await call('web_page_show', { watch_ms: 6000, timeout_secs: 240, with_script_text: true, with_storage_names: true, with_console_text: true, with_accessibility_text: true });
  const ev = show.data?.evidence_id || show.data?.id || show.data?.evidence?.id;
  save('page-show-evidence-id.txt', String(ev || ''));
  if (ev) await call('web_scripts_save', { capture: { kind: 'saved', evidence_id: ev }, output_directory: path.join(OUT, 'scripts') });
};
