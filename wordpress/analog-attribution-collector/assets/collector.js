(function () {
  'use strict';

  const cfg = window.AnalogCollectorConfig || {};
  const eventEndpoint = cfg.eventEndpoint;
  const phoneEndpoint = cfg.phoneEndpoint;
  if (!eventEndpoint) return;

  const visitorKey = 'analog_visitor_id';
  const sessionKey = 'analog_session_id';
  const sessionTtl = 30 * 60 * 1000;

  function uuidFromStorage(storage, name) {
    const current = storage.getItem(name);
    if (current && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current)) return current;
    const next = crypto.randomUUID();
    storage.setItem(name, next);
    return next;
  }

  function getVisitor() {
    return uuidFromStorage(localStorage, visitorKey);
  }

  function getSession() {
    const now = Date.now();
    try {
      const raw = sessionStorage.getItem(sessionKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.id === 'string' && now - Number(parsed.last) <= sessionTtl) {
          parsed.last = now;
          sessionStorage.setItem(sessionKey, JSON.stringify(parsed));
          return parsed.id;
        }
      }
    } catch (_) {}
    const session = { id: crypto.randomUUID(), last: now };
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    return session.id;
  }

  function params() {
    const url = new URL(window.location.href);
    return {
      utm_source: url.searchParams.get('utm_source'),
      utm_medium: url.searchParams.get('utm_medium'),
      utm_campaign: url.searchParams.get('utm_campaign'),
      utm_term: url.searchParams.get('utm_term'),
      utm_content: url.searchParams.get('utm_content')
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
    return fetch(eventEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    }).catch(() => undefined);
  }

  function applyTrackingNumber(phoneNumber) {
    const links = document.querySelectorAll('a[href^="tel:"]');
    links.forEach(function (link) {
      link.setAttribute('href', 'tel:' + phoneNumber.replace(/\s+/g, ''));
      if (/\d/.test(link.textContent || '')) link.textContent = phoneNumber;
    });
    document.querySelectorAll('[data-analog-phone]').forEach(function (element) {
      element.textContent = phoneNumber;
      if (element.tagName === 'A') element.setAttribute('href', 'tel:' + phoneNumber.replace(/\s+/g, ''));
    });
  }

  async function assignTrackingNumber() {
    if (!phoneEndpoint) return;
    const response = await fetch(phoneEndpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: getVisitor(), session_id: getSession() }),
      keepalive: true
    });
    if (!response.ok) return;
    const result = await response.json().catch(() => null);
    if (result && result.phone_number) applyTrackingNumber(result.phone_number);
  }

  window.AnalogAttribution = { track: send };

  document.addEventListener('DOMContentLoaded', function () {
    send('page_view', {
      title: document.title,
      device_width: window.innerWidth
    }).then(function () {
      assignTrackingNumber().catch(function () {});
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
        send(target.getAttribute('data-analog-event'), { source: 'data-analog-event' });
      }
    }, { passive: true });
  });
})();
