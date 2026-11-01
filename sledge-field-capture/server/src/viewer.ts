/** Read-only web view of everything the server has received. Polls every 3s. */
export const viewerHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Field Capture · Server</title>
<style>
  :root {
    --bg: #0f1419; --card: #171d24; --line: #26303b; --text: #e6edf3; --muted: #8b98a5;
    --accent: #f5a524; --ok: #2fbf71; --low: #5b8def; --medium: #f5a524; --high: #f0703a; --critical: #e5484d;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  header { position: sticky; top: 0; background: rgba(15,20,25,.9); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); padding: 16px; z-index: 1; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px rgba(47,191,113,.15); }
  .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
  main { padding: 16px; }
  .empty { color: var(--muted); text-align: center; padding: 64px 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 12px; transition: border-color .6s, box-shadow .6s; }
  .card.fresh { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(245,165,36,.18); }
  .row { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
  .title { font-weight: 600; font-size: 16px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .chip { font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); text-transform: capitalize; }
  .sev-low { color: var(--low); border-color: currentColor; } .sev-medium { color: var(--medium); border-color: currentColor; }
  .sev-high { color: var(--high); border-color: currentColor; } .sev-critical { color: var(--critical); border-color: currentColor; }
  .desc { color: #c4ced8; margin: 10px 0 0; white-space: pre-wrap; }
  .meta { color: var(--muted); font-size: 12px; margin-top: 10px; display: flex; gap: 14px; flex-wrap: wrap; }
  .media { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .media img { width: 120px; height: 90px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
  audio { height: 36px; }
  .dedupe { color: var(--accent); }
</style>
</head>
<body>
<header><div class="wrap">
  <h1><span class="dot"></span>Field Capture · Server inbox</h1>
  <div class="sub" id="status">Loading…</div>
</div></header>
<main class="wrap" id="list"></main>
<script>
  const seen = new Set();
  let first = true;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso) => new Date(iso).toLocaleString();

  function render(items) {
    const list = document.getElementById('list');
    if (!items.length) { list.innerHTML = '<div class="empty">No reports received yet.</div>'; return; }
    list.innerHTML = items.map((r) => {
      const fresh = !first && !seen.has(r.id);
      const media = r.attachments.map((a) => a.kind === 'photo'
        ? '<a href="' + a.url + '" target="_blank"><img loading="lazy" src="' + a.url + '" alt="photo" /></a>'
        : '<audio controls preload="none" src="' + a.url + '"></audio>').join('');
      const loc = r.latitude != null ? r.latitude.toFixed(5) + ', ' + r.longitude.toFixed(5) : 'No location';
      return '<article class="card' + (fresh ? ' fresh' : '') + '">'
        + '<div class="row"><div><div class="title">' + esc(r.title) + '</div>'
        + '<div class="chips"><span class="chip">' + esc(r.category) + '</span>'
        + '<span class="chip sev-' + esc(r.severity) + '">' + esc(r.severity) + '</span></div></div></div>'
        + (r.description ? '<p class="desc">' + esc(r.description) + '</p>' : '')
        + (media ? '<div class="media">' + media + '</div>' : '')
        + '<div class="meta"><span>Captured ' + fmt(r.captured_at) + '</span><span>Received ' + fmt(r.received_at) + '</span>'
        + '<span>' + loc + '</span>'
        + (r.delivery_count > 1 ? '<span class="dedupe">Delivered ' + r.delivery_count + '× · stored once</span>' : '')
        + '</div></article>';
    }).join('');
    items.forEach((r) => seen.add(r.id));
    first = false;
  }

  async function tick() {
    try {
      const res = await fetch('/v1/reports');
      const { items } = await res.json();
      render(items);
      document.getElementById('status').textContent = items.length + ' report(s) · updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      document.getElementById('status').textContent = 'Failed to load: ' + e.message;
    }
  }
  tick();
  setInterval(tick, 3000);
</script>
</body>
</html>`;
