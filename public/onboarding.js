(() => {
  const api = async (path, options={}) => {
    const r=await fetch(path,{credentials:"same-origin",...options});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||"request_failed");
    return d;
  };
  const esc=v=>String(v??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  let modal;
  function ensureModal(){
    if(modal)return modal;
    modal=document.createElement("div"); modal.className="modal"; modal.id="supplierOnboardingModal";
    modal.innerHTML='<div class="modal-card"><div class="top"><div><h2 style="margin:0">Onboard supplier to website</h2><p class="muted">Configure the complete Tracking → Forwarding → Destination route.</p></div><button class="btn" id="closeOnboarding">Close</button></div><div id="onboardingBody"></div></div>';
    document.body.appendChild(modal); modal.onclick=e=>{if(e.target===modal)modal.classList.remove("open")};
    modal.querySelector("#closeOnboarding").onclick=()=>modal.classList.remove("open"); return modal;
  }
  async function open(supplierId){
    const m=ensureModal(), body=m.querySelector("#onboardingBody"); m.classList.add("open");
    body.innerHTML='<div class="muted">Loading websites, tracking numbers and forwarding pool…</div>';
    try{
      const [suppliers,sites,forwards]=await Promise.all([api("/v1/dashboard/supplier-directory"),api("/v1/dashboard/sites"),api("/v1/dashboard/forwarding-numbers")]);
      const supplier=(suppliers.suppliers||[]).find(x=>x.id===supplierId); if(!supplier)throw new Error("supplier_not_found");
      const activeForwards=(forwards.forwarding_numbers||[]).filter(x=>x.active);
      const websiteOptions=(sites.sites||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+" — "+esc(x.hostname)+"</option>").join("");
      body.innerHTML='<form id="onboardingForm"><div class="field"><label>Supplier</label><input value="'+esc(supplier.name)+'" disabled></div><div class="field"><label>Website</label><select id="onboardSite" required>'+websiteOptions+'</select></div><div class="field"><label>Tracking number</label><select id="onboardTracking" required><option value="">Select website first</option></select><small class="muted">Must be a number already controlled by Analog and assigned to this website.</small></div><div class="field"><label>Forwarding number</label><select id="onboardForwarding" required>'+activeForwards.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.phone_number)+" — "+esc(x.provider)+"</option>").join("")+'</select></div><div class="field"><label>Supplier destination</label><input value="'+esc(supplier.contact_phone||supplier.endpoint_url||"Not configured")+'" disabled></div><div class="field"><label>Supplier rank</label><select id="onboardRank"><option value="1">Rank 1</option><option value="2">Rank 2</option><option value="3">Rank 3</option><option value="4">Rank 4</option><option value="5">Rank 5</option></select></div><label class="toolbar"><input id="onboardActive" type="checkbox" checked> Activate route immediately</label><div id="onboardPreview" class="block" style="margin-top:12px">Select a website and tracking number.</div><div class="toolbar"><button class="btn primary" type="submit">Onboard & configure route</button><button class="btn" type="button" id="cancelOnboarding">Cancel</button></div></form>';
      const siteSel=body.querySelector("#onboardSite"), trackSel=body.querySelector("#onboardTracking"), preview=body.querySelector("#onboardPreview");
      async function loadTracking(){
        trackSel.innerHTML='<option value="">Loading…</option>';
        const data=await api("/v1/dashboard/numbers?siteId="+encodeURIComponent(siteSel.value));
        const rows=(data.numbers||[]); trackSel.innerHTML=rows.length?rows.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.phone_number)+" — "+esc(x.active?"active":"inactive")+"</option>").join(""):'<option value="">No tracking numbers on this website</option>';
        previewRoute();
      }
      function previewRoute(){const t=trackSel.options[trackSel.selectedIndex]?.textContent||"Select tracking";const f=body.querySelector("#onboardForwarding").options[body.querySelector("#onboardForwarding").selectedIndex]?.textContent||"Select forwarding";preview.textContent="Tracking: "+t+"  →  Forwarding: "+f+"  →  Destination: "+(supplier.contact_phone||supplier.endpoint_url||"Not configured");}
      siteSel.onchange=()=>loadTracking().catch(e=>preview.textContent=e.message); trackSel.onchange=previewRoute; body.querySelector("#onboardForwarding").onchange=previewRoute;
      body.querySelector("#cancelOnboarding").onclick=()=>m.classList.remove("open");
      body.querySelector("#onboardingForm").onsubmit=async e=>{e.preventDefault();const b=e.currentTarget,button=b.querySelector('button[type="submit"]');button.disabled=true;preview.textContent="Configuring route…";try{const result=await api("/v1/dashboard/supplier-onboarding",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({siteId:siteSel.value,supplierId,trackingNumberId:trackSel.value,forwardingNumberId:b.querySelector("#onboardForwarding").value,rank:Number(b.querySelector("#onboardRank").value),active:b.querySelector("#onboardActive").checked})});const r=result.route;preview.innerHTML="<b>Route active:</b> "+esc(r.tracking_number)+" → "+esc(r.forwarding_number)+" → "+esc(r.destination_number);button.textContent="Configured";setTimeout(()=>m.classList.remove("open"),900);if(window.AnalogSuppliers?.open)window.AnalogSuppliers.open();}catch(err){preview.textContent=err.message||"Onboarding failed";button.disabled=false;}};
      await loadTracking();
    }catch(e){body.innerHTML='<div class="muted">Could not load onboarding data: '+esc(e.message)+'</div>'}
  }
  function wire(){
    if(window.__analogOnboardingBound)return; window.__analogOnboardingBound=true;
    const table=document.querySelector("#supplierTable"); if(!table)return;
    const observer=new MutationObserver(()=>table.querySelectorAll("[data-edit]").forEach(btn=>{if(btn.dataset.onboardBound)return;btn.dataset.onboardBound="1";const x=document.createElement("button");x.className="btn primary";x.textContent="Onboard";x.onclick=()=>open(btn.dataset.edit);btn.parentElement.appendChild(x);})); observer.observe(table,{childList:true,subtree:true});
  }
  setTimeout(wire,0); window.AnalogOnboarding={open};
})();
