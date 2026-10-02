(function () {
  try {
    var host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return;
    var path = (location.pathname || '/').slice(0, 200);
    if (/^\/admin/i.test(path)) return;
    if (navigator.webdriver) return;
    var last = null;
    try { last = JSON.parse(sessionStorage.getItem('cn_last') || 'null'); } catch (e) {}
    if (last && last.p === path && Date.now() - last.t < 30000) return;
    try { sessionStorage.setItem('cn_last', JSON.stringify({ p: path, t: Date.now() })); } catch (e) {}
    var sid = null;
    try { sid = localStorage.getItem('cn_sid'); } catch (e) {}
    if (!sid) {
      sid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
      try { localStorage.setItem('cn_sid', sid); } catch (e) {}
    }
    var sent = false;
    function send(uid) {
      if (sent) return;
      sent = true;
      try {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          body: JSON.stringify({ path: path, sid: sid, uid: uid || null, ref: (document.referrer || '').slice(0, 200) })
        }).catch(function () {});
      } catch (e) {}
    }
    var hasAuth = !!document.querySelector('script[src*="chartnalist-app-auth"]');
    if (!hasAuth) { send(null); return; }
    var tries = 0;
    (function wait() {
      var sb = window.chartnalistSupabase;
      if (sb && sb.auth && sb.auth.getSession) {
        sb.auth.getSession().then(function (r) {
          var s = r && r.data && r.data.session;
          send(s && s.user ? s.user.id : null);
        }).catch(function () { send(null); });
        return;
      }
      if (++tries > 12) { send(null); return; }
      setTimeout(wait, 250);
    })();
  } catch (e) {}
})();