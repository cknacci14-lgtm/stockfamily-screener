'use strict';
/*
 * Triggers the "QBS Daily Screener" GitHub workflow right after a data upload,
 * so the Signal Center snapshot and the live signal log are built from the
 * uploaded trading day instead of waiting for the scheduled run.
 * It never throws: a failed trigger must not break the upload.
 *
 *   node src/lib/dispatch-workflow.js check     read-only access check (does not trigger a run)
 */
const OWNER = process.env.GITHUB_DISPATCH_OWNER || 'cknacci14-lgtm';
const REPO = process.env.GITHUB_DISPATCH_REPO || 'stockfamily-screener';
const WORKFLOW = process.env.GITHUB_DISPATCH_WORKFLOW || 'qbs-daily-screener.yml';
const REF = process.env.GITHUB_DISPATCH_REF || 'main';
const MIN_GAP_MS = 10 * 60 * 1000;
let lastTriggerAt = 0;

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'chartnalist-upload',
    'Content-Type': 'application/json'
  };
}

async function triggerDailyWorkflow(reason) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { ok: false, skipped: 'GITHUB_DISPATCH_TOKEN not set' };
  if (Date.now() - lastTriggerAt < MIN_GAP_MS) return { ok: false, skipped: 'triggered less than 10 minutes ago' };
  try {
    const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/actions/workflows/' + WORKFLOW + '/dispatches';
    const res = await fetch(url, { method: 'POST', headers: headers(token), body: JSON.stringify({ ref: REF }) });
    if (res.status === 204) {
      lastTriggerAt = Date.now();
      console.log('[dispatch] workflow triggered' + (reason ? ' (' + reason + ')' : ''));
      return { ok: true };
    }
    const text = await res.text().catch(function () { return ''; });
    console.warn('[dispatch] GitHub answered ' + res.status + ' ' + text.slice(0, 200));
    return { ok: false, status: res.status };
  } catch (e) {
    console.warn('[dispatch] failed:', e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function checkAccess() {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { ok: false, skipped: 'GITHUB_DISPATCH_TOKEN not set' };
  try {
    const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/actions/workflows/' + WORKFLOW;
    const res = await fetch(url, { headers: headers(token) });
    const j = await res.json().catch(function () { return {}; });
    return { ok: res.ok, status: res.status, workflow: j.name || null, state: j.state || null, message: res.ok ? undefined : j.message };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

module.exports = { triggerDailyWorkflow, checkAccess };

if (require.main === module) {
  try { require('dotenv').config(); } catch (e) { /* env from shell */ }
  if (process.argv[2] === 'check') {
    checkAccess().then(function (r) { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1); });
  } else {
    console.log('pemakaian: node src/lib/dispatch-workflow.js check');
    process.exit(1);
  }
}