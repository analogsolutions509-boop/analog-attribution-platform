(() => {
const numberState={forwarding:[],editing:null};
const q=(s)=>document.querySelector(s);
const escN=(v)=>String(v??"").replace(/[&<>"]/g,c=>c==="&"?"&amp;":c==="<"?"&lt;":c===">"?"&gt;":"&quot;");
async function loadForwarding(){
  try{
    const r=await api("/v1/dashboard/forwarding-numbers");
    numberState.forwarding=r.forwarding_numbers||[];
    state.forwardingNumbers=numberState.forwarding;
    renderForwarding();
  }catch(e){ q("#forwardingTable").innerHTML='<div class="empty">Forwarding numbers unavailable.</div>'; }
}
function fillForwardingSelect(selected=""){
  const el=q("#numberForwarding");
  if(!el)return;
  el.innerHTML='<option value="">Not configured</option>'+
    numberState.forwarding.filter(x=>x.active).map(x=>'<option value="'+escN(x.id)+'">'+
    escN(x.phone_number+" — "+(x.label||x.provider))+"</option>").join("");
  el.value=selected||"";
}
function renderForwarding(){
  const el=q("#forwardingTable");
  if(!el)return;
  const rows=numberState.forwarding;
  if(!rows.length){el.innerHTML='<div class="empty">No forwarding numbers configured.</div>';return;}
  el.innerHTML='<div class="table-wrap"><table><thead><tr><th>Forwarding number</th><th>Provider</th><th>Label</th><th>Status</th><th>Used by</th><th>Actions</th></tr></thead><tbody>'+
    rows.map(x=>{
      const used=state.numbers.filter(n=>n.forwarding_number_id===x.id).length;
      return '<tr><td><b>'+escN(x.phone_number)+'</b></td><td>'+escN(x.provider)+'</td><td>'+escN(x.label||"—")+
        '</td><td>'+status(x.active?"active":"paused")+'</td><td>'+used+
        '</td><td><button class="btn" data-forward-action="edit" data-forward-id="'+escN(x.id)+'">Edit</button> '+
        '<button class="btn" data-forward-action="toggle" data-forward-id="'+escN(x.id)+'" data-active="'+(!x.active)+'">'+(x.active?"Deactivate":"Activate")+
        '</button> <button class="btn" data-forward-action="delete" data-forward-id="'+escN(x.id)+'">Delete</button></td></tr>';
    }).join("")+"</tbody></table></div>";
  document.querySelectorAll("[data-forward-action]").forEach(b=>{
    const id=b.dataset.forwardId,a=b.dataset.forwardAction;
    if(a==="edit")b.onclick=()=>openForwardingEditor(id);
    if(a==="toggle")b.onclick=()=>toggleForwarding(id,b.dataset.active==="true");
    if(a==="delete")b.onclick=()=>deleteForwarding(id);
  });
}
function openForwardingEditor(id=null){
  const item=numberState.forwarding.find(x=>x.id===id);
  numberState.editing=id;
  q("#forwardingEditorTitle").textContent=item?"Edit forwarding number":"Add forwarding number";
  q("#forwardingValue").value=item?.phone_number||"";
  q("#forwardingLabel").value=item?.label||"";
  q("#forwardingProvider").value=item?.provider||"other";
  q("#forwardingActive").checked=item?!!item.active:true;
  q("#forwardingActiveField").hidden=!item;
  q("#forwardingEditorNotice").textContent="";
  q("#forwardingEditorModal").classList.add("open");
}
function closeForwardingEditor(){numberState.editing=null;q("#forwardingEditorModal").classList.remove("open");}
async function saveForwarding(e){
  e.preventDefault();
  q("#forwardingEditorNotice").textContent="";
  const payload={phone_number:q("#forwardingValue").value,label:q("#forwardingLabel").value,provider:q("#forwardingProvider").value,active:q("#forwardingActive").checked};
  try{
    const path=numberState.editing?"/v1/dashboard/forwarding-numbers/"+encodeURIComponent(numberState.editing):"/v1/dashboard/forwarding-numbers";
    await api(path,{method:numberState.editing?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    closeForwardingEditor(); toast("Forwarding number saved."); await loadForwarding();
    fillForwardingSelect(q("#numberForwarding")?.value||""); renderNumbers();
  }catch(err){q("#forwardingEditorNotice").textContent=err.message||"Forwarding number could not be saved.";}
}
async function toggleForwarding(id,active){
  try{await api("/v1/dashboard/forwarding-numbers/"+encodeURIComponent(id),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({active})});toast(active?"Forwarding number activated.":"Forwarding number deactivated.");await loadForwarding();fillForwardingSelect();}
  catch(err){toast(err.message||"Forwarding number could not be changed.");}
}
async function deleteForwarding(id){
  const item=numberState.forwarding.find(x=>x.id===id);
  if(!item)return;
  if(!window.confirm("Delete forwarding number "+item.phone_number+"? It must not be linked to any tracking number."))return;
  try{await api("/v1/dashboard/forwarding-numbers/"+encodeURIComponent(id),{method:"DELETE"});toast("Forwarding number deleted.");await loadForwarding();fillForwardingSelect();}
  catch(err){toast(err.message||"Forwarding number could not be deleted.");}
}
function routeIssueLabel(issue){
  const labels={
    tracking_number_inactive:"Tracking number is paused",
    forwarding_number_missing:"Forwarding number not linked",
    forwarding_number_not_found:"Linked forwarding number is missing",
    forwarding_number_inactive:"Forwarding number is paused",
    destination_supplier_missing:"No destination supplier assigned",
    destination_supplier_inactive:"Destination supplier is inactive or missing",
    destination_supplier_not_assigned_to_site:"Supplier is not assigned to this website",
    destination_contact_missing:"Supplier destination phone/endpoint is missing"
  };
  return labels[issue]||"Route needs configuration";
}
function renderManagedNumbers(){
  const rows=state.numbers||[];
  const active=rows.filter(n=>n.active).length;
  const ready=rows.filter(n=>n.pool_ready===true).length;
  const activeForwarding=numberState.forwarding.filter(x=>x.active).length;
  q("#numbersMetrics").innerHTML=[
    ["Tracking numbers",rows.length,"Total inventory"],
    ["Active numbers",active,"Currently enabled"],
    ["Ready routes",ready,"Tracking + forwarding + destination"],
    ["Forwarding numbers",activeForwarding,"Active Analog forwarding identities"]
  ].map(x=>'<div class="card metric"><div class="label">'+x[0]+'</div><div class="value">'+x[1]+'</div><div class="hint">'+x[2]+'</div></div>').join("");
  if(!rows.length){q("#numbersTable").innerHTML='<div class="empty">No tracking numbers configured.</div>';return;}
  q("#numbersTable").innerHTML='<div class="table-wrap"><table><thead><tr><th>Tracking</th><th>Website</th><th>Forwarding</th><th>Destination</th><th>Route</th><th>Visitors</th><th>Actions</th></tr></thead><tbody>'+
    rows.map(n=>{
      const ready=n.pool_ready===true;
      const routeStatus=ready?status("ready"):status("incomplete")+'<br><span class="muted">'+escN(routeIssueLabel(n.pool_issue))+'</span>';
      return '<tr><td><b>'+escN(n.phone_number)+'</b><br><span class="muted">'+escN(n.label||"")+'</span></td>'+
      '<td>'+escN(n.site_name)+'<br><span class="muted">'+escN(n.hostname)+'</span></td>'+
      '<td>'+escN(n.forwarding_number||"Not linked")+'</td>'+
      '<td>'+escN(n.destination_number||"No real destination")+(n.destination_supplier_name?"<br><span class=\"muted\">"+escN(n.destination_supplier_name)+"</span>":"")+'</td>'+
      '<td>'+routeStatus+'</td><td>'+n.active_assignments+'</td>'+
      '<td><button class="btn" data-number-action="edit" data-number-id="'+escN(n.id)+'">Edit</button> '+
      '<button class="btn" data-number-action="toggle" data-number-id="'+escN(n.id)+'" data-active="'+(!n.active)+'">'+(n.active?"Deactivate":"Activate")+
      '</button> <button class="btn" data-number-action="delete" data-number-id="'+escN(n.id)+'">Delete</button></td></tr>';
    }).join("")+"</tbody></table></div>";
  document.querySelectorAll("[data-number-action]").forEach(b=>{
    const id=b.dataset.numberId,a=b.dataset.numberAction;
    if(a==="edit")b.onclick=()=>openNumberEditorManaged(id);
    if(a==="toggle")b.onclick=()=>toggleNumber(id,b.dataset.active==="true");
    if(a==="delete")b.onclick=()=>deleteNumber(id);
  });
}
function populateNumberSitesManaged(selected){
  const el=q("#numberSite");
  el.innerHTML=state.sites.map(s=>'<option value="'+escN(s.id)+'">'+escN(s.name)+" — "+escN(s.hostname)+"</option>").join("");
  if(selected)el.value=selected;
}
async function openNumberEditorManaged(id=null){
  if(id){await openNumberEditorManagedExisting(id);return;}
  numberState.editing=null;populateNumberSitesManaged(state.siteId||state.sites[0]?.id||"");
  q("#numberValues").value="";q("#numberLabel").value="";q("#numberActive").checked=true;
  q("#numberActiveField").hidden=true;q("#numberEditorTitle").textContent="Add tracking number(s)";
  q("#numberEditorNotice").textContent="";fillForwardingSelect();q("#numberDestination").innerHTML='<option value="">No primary destination</option>';
  q("#numberEditorModal").classList.add("open");await loadNumberDestinationOptions(q("#numberSite").value);
}
async function openNumberEditorManagedExisting(id){
  const n=state.numbers.find(x=>x.id===id);if(!n)return;
  numberState.editing=id;populateNumberSitesManaged(n.site_id);q("#numberValues").value=n.phone_number||"";q("#numberLabel").value=n.label||"";
  q("#numberActive").checked=!!n.active;q("#numberActiveField").hidden=false;q("#numberEditorTitle").textContent="Edit tracking number";
  q("#numberEditorNotice").textContent="";fillForwardingSelect(n.forwarding_number_id||"");
  q("#numberEditorModal").classList.add("open");await loadNumberDestinationOptions(n.site_id,n.destination_supplier_id||"");
}
async function saveNumberManaged(e){
  e.preventDefault();const siteId=q("#numberSite").value;
  const values=q("#numberValues").value.split(/[,\n]+/).map(v=>v.trim()).filter(Boolean);
  const destination=q("#numberDestination").value||null,forwarding=q("#numberForwarding").value||null;
  const active=!!q("#numberActive").checked;
  q("#numberEditorNotice").textContent="";
  if(!siteId){q("#numberEditorNotice").textContent="Choose a website.";return;}
  if(!numberState.editing&&!values.length){q("#numberEditorNotice").textContent="Enter at least one tracking number.";return;}
  if(numberState.editing&&values.length!==1){q("#numberEditorNotice").textContent="Edit one tracking number at a time.";return;}
  if(active&&(!forwarding||!destination)){q("#numberEditorNotice").textContent="An active route needs Tracking + Forwarding + Destination.";return;}
  try{
    if(numberState.editing){
      await api("/v1/dashboard/numbers/"+encodeURIComponent(numberState.editing),{method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({site_id:siteId,phone_number:values[0],label:q("#numberLabel").value,active,destination_supplier_id:destination,forwarding_number_id:forwarding})});
      toast("Tracking number updated.");
    }else{
      const r=await api("/v1/dashboard/numbers",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({site_id:siteId,numbers:values,label:q("#numberLabel").value,active,destination_supplier_id:destination,forwarding_number_id:forwarding})});
      toast((r.numbers||[]).length+" tracking number(s) added.");
    }
    closeNumberEditorManaged();await loadAll();
  }catch(err){q("#numberEditorNotice").textContent=err.message||"Tracking number could not be saved.";}
}
function closeNumberEditorManaged(){q("#numberEditorModal").classList.remove("open");numberState.editing=null;}
function install(){
  if(!q("#numbersView"))return;
  window.renderNumbers=renderManagedNumbers;
  const originalLoadAll=window.loadAll;
  window.loadAll=async function(){const result=await originalLoadAll();await loadForwarding();renderManagedNumbers();return result;};
  q("#addNumberBtn").onclick=()=>openNumberEditorManaged();
  q("#closeNumberEditor").onclick=closeNumberEditorManaged;
  q("#cancelNumberEditor").onclick=closeNumberEditorManaged;
  q("#numberForm").onsubmit=saveNumberManaged;
  q("#numberSite").onchange=()=>loadNumberDestinationOptions(q("#numberSite").value);
  q("#addForwardingBtn").onclick=()=>openForwardingEditor();
  q("#closeForwardingEditor").onclick=closeForwardingEditor;
  q("#cancelForwardingEditor").onclick=closeForwardingEditor;
  q("#forwardingForm").onsubmit=saveForwarding;
  q("#forwardingEditorModal").onclick=e=>{if(e.target.id==="forwardingEditorModal")closeForwardingEditor();};
  loadForwarding().then(()=>{fillForwardingSelect();renderManagedNumbers();});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})();