(function () {
  'use strict';

  const cfg = window.AnalogCollectorConfig || {};
  const eventEndpoint = cfg.eventEndpoint;
  const phoneEndpoint = cfg.phoneEndpoint;
  if (!eventEndpoint) return;

  const visitorKey = 'analog_visitor_id';
  const sessionKey = 'analog_session_id';
  const sessionTtl = 30 * 60 * 1000;
  const capturedForms = new WeakSet();

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
  }  function params() {
    const url = new URL(window.location.href);
    return {
      utm_source: url.searchParams.get('utm_source'),
      utm_medium: url.searchParams.get('utm_medium'),
      utm_campaign: url.searchParams.get('utm_campaign'),
      utm_term: url.searchParams.get('utm_term'),
      utm_content: url.searchParams.get('utm_content')
    };
  }

  function normalizeLabel(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fieldMeta(control) {
    const parts = [
      control.name,
      control.id,
      control.getAttribute && control.getAttribute('aria-label'),
      control.getAttribute && control.getAttribute('placeholder')
    ];
    const label = control.labels && control.labels.length ? control.labels[0].textContent : '';
    if (label) parts.push(label);
    return normalizeLabel(parts.filter(Boolean).join(' '));
  }

  function classifyField(meta) {
    if (/e-?mail/.test(meta)) return 'customer_email';
    if (/phone|mobile|telephone|tel/.test(meta)) return 'customer_phone';
    if (/company|business|firm|organisation|organization/.test(meta)) return 'company_name';
    if (/service|material|concrete|rebar|reinforcement|type|product|subject/.test(meta)) return 'service_type';
    if (/message|enquir|question|details|requirement|project|note|comment/.test(meta)) return 'message';
    if (/name|full name|contact/.test(meta)) return 'customer_name';
    return null;
  }

  function controlValue(control) {
    if (!control || control.disabled || control.type === 'submit' ||
        control.type === 'button' || control.type === 'reset' ||
        control.type === 'hidden' || control.type === 'password') return '';
    return String(control.value || '').trim();
  }  function extractFormLead(form) {
    const payload = { requirements: {} };
    const controls = Array.prototype.slice.call(form.querySelectorAll('input,select,textarea'));
    controls.forEach(function (control) {
      const value = controlValue(control);
      if (!value) return;
      const meta = fieldMeta(control);
      const field = classifyField(meta);
      if (field && !payload[field]) payload[field] = value;
      else if (meta) payload.requirements[meta.slice(0, 80)] = value;
    });
    if (!payload.customer_phone && !payload.customer_email) return null;
    if (!payload.customer_name) {
      const first = controls.find(function (control) {
        return /text/i.test(control.type || 'text') && /name|contact/i.test(fieldMeta(control)) && controlValue(control);
      });
      if (first) payload.customer_name = controlValue(first);
    }
    return payload;
  }

  function candidateForm(form) {
    if (!form || !form.querySelectorAll) return false;
    const meta = normalizeLabel([
      form.id, form.name, form.className,
      form.getAttribute && form.getAttribute('action'),
      form.getAttribute && form.getAttribute('aria-label')
    ].filter(Boolean).join(' '));
    if (/search|login|log in|register|newsletter|subscribe|comment/.test(meta)) return false;
    return form.querySelectorAll('input,select,textarea').length >= 2;
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
  }  function applyTrackingNumber(phoneNumber) {
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

  function bindForms(root) {
    const forms = (root || document).querySelectorAll ? (root || document).querySelectorAll('form') : [];
    Array.prototype.forEach.call(forms, function (form) {
      if (!candidateForm(form) || capturedForms.has(form)) return;
      capturedForms.add(form);
      form.addEventListener('submit', function () {
        const lead = extractFormLead(form);
        if (lead) send('form_submit', lead);
      }, { passive: true });
    });
  }  window.AnalogAttribution = { track: send, captureForm: function (form) {
    const lead = extractFormLead(form);
    return lead ? send('lead_submit', lead) : Promise.resolve();
  }};

  document.addEventListener('DOMContentLoaded', function () {
    send('page_view', {
      title: document.title,
      device_width: window.innerWidth
    }).then(function () {
      assignTrackingNumber().catch(function () {});
    });

    bindForms(document);

    document.addEventListener('click', function (event) {
      const target = event.target.closest && event.target.closest('a[href]');
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