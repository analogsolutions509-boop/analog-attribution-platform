(function () {
  'use strict';

  const cfg = window.AnalogCollectorConfig || {};
  const endpoint = cfg.endpoint;
  if (!endpoint) return;

  const key = 'analog_visitor_id';
  const sessionKey = 'analog_session_id';
  const now = Date.now();
  const sessionTtl = 30 * 60 * 1000;

  function getOrCreate(storage, name, generator) {
    let value = storage.getItem(name);
    if (!value) {
      value = generator();
      storage.setItem(name, value);
    }
    return value;
  }

  function id(prefix) {
    return prefix + '_' + crypto.randomUUID();
  }

  function getVisitor() {
    return getOrCreate(localStorage, key, () => id('v'));
  }

  function getSession() {
    const raw = sessionStorage.getItem(sessionKey);
    if (!raw) {
      const session = { id: id('s'), last: now };
      sessionStorage.setItem(sessionKey, JSON.stringify(session));
      return session.id;
    }
    const parsed = JSON.parse(raw);
    if (now - parsed.last > sessionTtl) {
      const session = { id: id('s'), last: now };
      sessionStorage.setItem(sessionKey, JSON.stringify(session));
      return session.id;
    }
    parsed.last = now;
    sessionStorage.setItem(sessionKey, JSON.stringify(parsed));
    return parsed.id;
  }

  function params() {
    const u = new URL(window.location.href);
    return {
      utm_source: u.searchParams.get('utm_source'),
      utm_medium: u.searchParams.get('utm_medium'),
      utm_campaign: u.searchParams.get('utm_campaign'),
      utm_term: u.searchParams.get('utm_term'),
      utm_content: u.searchParams.get('utm_content')
    };
  }

  function send(name, payload) {
    const body = {
      event_key: getSession() + ':' + name + ':' + Date.now() + ':' + Math.random().toString(36).slice(2),
      event_name: name,
      occurred_at: new Date().toISOString(),
      visitor_key: getVisitor(),
      session_key: getSession(),
      page_url: window.location.href,
      page_path: window.location.pathname,
      referrer: document.referrer || null,
      ...params(),
      payload: payload || {}
    };
    return fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).catch(() => undefined);
  }

  window.AnalogAttribution = { track: send };

  document.addEventListener('DOMContentLoaded', function () {
    send('page_view', {
      title: document.title,
      device_width: window.innerWidth
    });

    document.addEventListener('click', function (event) {
      const target = event.target.closest('a[href]');
      if (!target) return;
      const href = target.getAttribute('href') || '';
      if (/^tel:/i.test(href)) {
        send('phone_click', { href: href.replace(/^tel:/i, '') });
      }
      if (/^mailto:/i.test(href)) {
        send('email_click', { href: href.replace(/^mailto:/i, '') });
      }
      if (target.matches('[data-analog-event]')) {
        send(target.getAttribute('data-analog-event'), {
          source: 'data-analog-event'
        });
      }
    }, { passive: true });
  });
})();
