(() => {
  const api = async (path, options = {}) => {
    const response = await fetch(path, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("auth");
    if (!response.ok) throw new Error(data.error || "request_failed");
    return data;
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"
  );

  const state = { suppliers: [], sites: [], selected: null };

  function root() {
    return document.querySelector("main.main");
  }

  function section() {
    let el = document.querySelector("#suppliersView");
    if (el) return el;
    el = document.createElement("section");
    el.id = "suppliersView";
    el.hidden = true;
    el.innerHTML =
      '<div class="content-grid">' +
      '<div class="card"><div class="top" style="margin-bottom:12px"><div><h2 style="margin:0">Supplier directory</h2><p class="muted">Onboard suppliers once, then attach them to any Analog website.</p></div>' +
      '<button id="supplierAdd" class="btn primary">Add supplier</button></div><div id="supplierNotice" class="muted"></div><div id="supplierTable"></div></div>' +
      '<div class="card"><h2 id="supplierEditorTitle">Add supplier</h2>' +
      '<form id="supplierForm"><div class="field"><label>Company name</label><input id="supplierName" required maxlength="160"></div>' +
      '<div class="field"><label>Forwarding phone</label><input id="supplierPhone" placeholder="+44..."></div>' +
      '<div class="field"><label>SIP / PBX destination</label><input id="supplierEndpoint" placeholder="sip:1000@supplier.example"></div>' +
      '<div class="field"><label>Notification email</label><input id="supplierEmail" type="email"></div>' +
      '<div class="field"><label>Notification SMS</label><input id="supplierSms"></div>' +
      '<div class="field"><label>Status</label><select id="supplierStatus"><option value="active">Active</option><option value="paused">Paused</option></select></div>' +
      '<div class="toolbar"><button class="btn primary" type="submit">Save supplier</button><button id="supplierCancel" class="btn" type="button">Clear</button></div></form>' +
      '<div id="assignmentPanel" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line)" hidden>' +
      '<h2>Website forwarding assignments</h2><div class="toolbar"><select id="assignmentSite"></select><select id="assignmentRank"><option value="1">Rank 1</option><option value="2">Rank 2</option><option value="3">Rank 3</option><option value="4">Rank 4</option><option value="5">Rank 5</option></select><button id="assignmentAdd" class="btn primary" type="button">Assign</button></div><div id="assignmentList"></div></div></div></div>';
    root().appendChild(el);
    return el;
  }

  function navButton() {
    let button = document.querySelector('.nav button[data-view="suppliers"]');
    if (button) return button;
    const nav = document.querySelector(".nav");
    if (!nav) return null;
    button = document.createElement("button");
    button.dataset.view = "suppliers";
    button.textContent = "Suppliers";
    nav.insertBefore(button, nav.querySelector('[data-view="system"]') || null);
    button.onclick = () => switchToSuppliers();
    return button;
  }

  function switchToSuppliers() {
    document.querySelectorAll("main.main > section").forEach((el) => { el.hidden = el.id !== "suppliersView"; });
    document.querySelector("#pageTitle").textContent = "Suppliers";
    document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === "suppliers"));
    section().hidden = false;
    load();
  }

  function renderTable() {
    const el = document.querySelector("#supplierTable");
    if (!state.suppliers.length) {
      el.innerHTML = '<div class="empty">No suppliers onboarded yet.</div>';
      return;
    }
    el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Status</th><th>Forwarding</th><th>Websites</th><th>Action</th></tr></thead><tbody>' +
      state.suppliers.map((s) =>
        '<tr><td><b>' + esc(s.name) + '</b><br><span class="muted">' + esc(s.notification_email || "No notification email") + '</span></td>' +
        '<td>' + (s.status === "active" ? '<span class="status green"><i class="dot"></i>active</span>' : '<span class="status amber"><i class="dot"></i>paused</span>') + '</td>' +
        '<td>' + esc(s.contact_phone || s.endpoint_url || "Not configured") + '</td><td>' + s.website_count + '</td>' +
        '<td><button class="btn" data-edit="' + esc(s.id) + '">Manage</button></td></tr>'
      ).join("") + '</tbody></table></div>';
    el.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => selectSupplier(b.dataset.edit));
  }

  function renderAssignments() {
    const list = document.querySelector("#assignmentList");
    if (!state.selected) { list.innerHTML = ""; return; }
    const rows = state.selected.assignments || [];
    list.innerHTML = rows.length
      ? rows.map((a) => '<div class="toolbar" style="justify-content:space-between"><span>' + esc(a.site_name || a.hostname) + ' — Rank ' + a.rank + ' ' + (a.active ? "" : "(paused)") + '</span><button class="btn" data-unassign="' + esc(a.assignment_id) + '">Remove</button></div>').join("")
      : '<div class="muted">This supplier is not assigned to any website.</div>';
    list.querySelectorAll("[data-unassign]").forEach((b) => b.onclick = async () => {
      try { await api("/v1/dashboard/site-supplier-assignments/" + encodeURIComponent(b.dataset.unassign), {method:"DELETE"}); await load(); selectSupplier(state.selected.id); }
      catch (e) { notice(e.message); }
    });
  }

  function populateSites() {
    const select = document.querySelector("#assignmentSite");
    select.innerHTML = state.sites.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + ' — ' + esc(s.hostname) + '</option>').join("");
  }
  function fillEditor(supplier) {
    state.selected = supplier || null;
    document.querySelector("#supplierEditorTitle").textContent = supplier ? "Manage supplier" : "Add supplier";
    document.querySelector("#supplierName").value = supplier?.name || "";
    document.querySelector("#supplierPhone").value = supplier?.contact_phone || "";
    document.querySelector("#supplierEndpoint").value = supplier?.endpoint_url || "";
    document.querySelector("#supplierEmail").value = supplier?.notification_email || "";
    document.querySelector("#supplierSms").value = supplier?.notification_sms || "";
    document.querySelector("#supplierStatus").value = supplier?.status || "active";
    document.querySelector("#assignmentPanel").hidden = !supplier;
    renderAssignments();
  }

  function notice(message) {
    const el = document.querySelector("#supplierNotice");
    el.textContent = message || "";
    if (message) setTimeout(() => { if (el.textContent === message) el.textContent = ""; }, 3500);
  }

  async function selectSupplier(id) {
    await load();
    const supplier = state.suppliers.find((s) => s.id === id);
    if (!supplier) return;
    fillEditor(supplier);
    document.querySelector("#supplierForm").scrollIntoView({behavior:"smooth", block:"start"});
  }

  async function load() {
    try {
      const [suppliers, sites] = await Promise.all([
        api("/v1/dashboard/supplier-directory"),
        api("/v1/dashboard/sites")
      ]);
      state.suppliers = suppliers.suppliers || [];
      state.sites = sites.sites || [];
      populateSites();
      renderTable();
      if (state.selected) {
        const refreshed = state.suppliers.find((s) => s.id === state.selected.id);
        fillEditor(refreshed || null);
      }
    } catch (error) {
      if (error.message === "auth") {
        notice("Dashboard authentication is required.");
      } else {
        notice("Supplier data could not be loaded.");
      }
    }
  }

  async function saveSupplier(event) {
    event.preventDefault();
    const payload = {
      name: document.querySelector("#supplierName").value,
      contact_phone: document.querySelector("#supplierPhone").value,
      endpoint_url: document.querySelector("#supplierEndpoint").value,
      notification_email: document.querySelector("#supplierEmail").value,
      notification_sms: document.querySelector("#supplierSms").value,
      status: document.querySelector("#supplierStatus").value
    };
    try {
      const id = state.selected?.id;
      if (id) {
        await api("/v1/dashboard/supplier-directory/" + encodeURIComponent(id), {
          method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify(payload)
        });
        notice("Supplier updated.");
      } else {
        const result = await api("/v1/dashboard/supplier-directory", {
          method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(payload)
        });
        notice("Supplier onboarded.");
        state.selected = result.supplier;
      }
      await load();
      selectSupplier(state.selected?.id);
    } catch (error) {
      notice(error.message || "Supplier could not be saved.");
    }
  }
  async function assignSupplier() {
    if (!state.selected) return notice("Select a supplier first.");
    const siteId = document.querySelector("#assignmentSite").value;
    const rank = Number(document.querySelector("#assignmentRank").value);
    try {
      await api("/v1/dashboard/sites/" + encodeURIComponent(siteId) + "/suppliers", {
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({supplier_id:state.selected.id, rank})
      });
      notice("Supplier assigned to website.");
      await load();
      selectSupplier(state.selected.id);
    } catch (error) {
      notice(error.message || "Assignment failed.");
    }
  }

  function bindOnce() {
    if (window.__analogSuppliersBound) return;
    window.__analogSuppliersBound = true;
    section();
    navButton();
    document.querySelector("#supplierAdd").onclick = () => fillEditor(null);
    document.querySelector("#supplierCancel").onclick = () => fillEditor(null);
    document.querySelector("#supplierForm").onsubmit = saveSupplier;
    document.querySelector("#assignmentAdd").onclick = assignSupplier;
  }

  window.AnalogSuppliers = { open: () => { bindOnce(); switchToSuppliers(); } };
  bindOnce();
})();
