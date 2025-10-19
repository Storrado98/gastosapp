// ========= CIFRADO =========
async function deriveKey(pin, salt){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2", salt, iterations:150000, hash:"SHA-256"},
    keyMaterial,
    {name:"AES-GCM", length:256},
    false,
    ["encrypt","decrypt"]
  );
}
async function encryptJson(obj, pin){
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  const data = enc.encode(JSON.stringify(obj));
  const buf = await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, data);
  return {iv:Array.from(iv), salt:Array.from(salt), payload:Array.from(new Uint8Array(buf))};
}
async function decryptJson(pack, pin){
  const {iv, salt, payload} = pack;
  const key = await deriveKey(pin, new Uint8Array(salt));
  const buf = await crypto.subtle.decrypt({name:"AES-GCM", iv:new Uint8Array(iv)}, key, new Uint8Array(payload));
  return JSON.parse(new TextDecoder().decode(buf));
}

// ========= ESTADO =========
const LAST_USER_KEY = "gastosapp_last_user";
const vaultKeyFor = (userId) => `gastosapp_vault_${userId}`;
const defaultState = (userId) => ({
  meta: {createdAt: new Date().toISOString(), version: 4},
  user: {id: userId, pinSet: true},
  monedas: [
    {code:"ARS", name:"Pesos", isCrypto:false, rate:1},
    {code:"USD", name:"Dólares", isCrypto:false, rate:null},
    {code:"BTC", name:"Bitcoin", isCrypto:true, rate:null},
    {code:"ETH", name:"Ethereum", isCrypto:true, rate:null},
    {code:"DOGE", name:"Dogecoin", isCrypto:true, rate:null},
  ],
  cuentas: [], // {id,nombre,tipo,multi,incluyeCaja,moneda,subMonedas[],saldoIni,fechaIni}
  movs: []     // {id, fecha, desc, monto, moneda, deb, cred, cat, tag}
});
let state = null;
let currentPin = null;
let currentUser = null;

// ========= HELPERS UI =========
const $ = (id)=>document.getElementById(id);
const ts = ()=> new Date().toISOString().replace(/[:.]/g,"-");
const todayISO = ()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); };
const toISO = (d)=> d.toISOString().slice(0,10);

// ========= VAULT LOAD/SAVE =========
async function loadVault(userId, pin){
  const key = vaultKeyFor(userId);
  const raw = localStorage.getItem(key);
  if(!raw){
    state = defaultState(userId);
    currentPin = pin; currentUser = userId;
    await saveVault();
    return true;
  }
  try{
    const pack = JSON.parse(raw);
    const s = await decryptJson(pack, pin);
    if(s.user.id !== userId) throw new Error("Usuario distinto");
    state = s; currentPin = pin; currentUser = userId;
    return true;
  }catch(e){
    console.error(e);
    return false;
  }
}
async function saveVault(){
  const key = vaultKeyFor(currentUser);
  const pack = await encryptJson(state, currentPin);
  localStorage.setItem(key, JSON.stringify(pack));
  localStorage.setItem(LAST_USER_KEY, currentUser);
}

// ========= RENDER =========
function renderMonedas(){
  const list = $("listaMonedas"); if(list) list.innerHTML = "";
  state.monedas.forEach(m=>{
    if(list){
      const el = document.createElement("div");
      el.className = "pill";
      el.textContent = `${m.code} · ${m.name}${m.rate?` · TC:${m.rate}`:""}`;
      list.appendChild(el);
    }
  });
  const selMonCta = $("ctaMoneda");
  if(selMonCta){ selMonCta.innerHTML=""; state.monedas.forEach(m=>{ const o=document.createElement("option"); o.value=m.code; o.textContent=m.code; selMonCta.appendChild(o); }); }
  const selMonMov = $("movMoneda");
  if(selMonMov){ selMonMov.innerHTML=""; state.monedas.forEach(m=>{ const o=document.createElement("option"); o.value=m.code; o.textContent=m.code; selMonMov.appendChild(o); }); }
}
function renderCuentas(){
  const list = $("listaCuentas"); if(list) list.innerHTML="";
  state.cuentas.forEach(c=>{
    if(list){
      const el = document.createElement("div");
      el.className = "pill";
      const si = (c.saldoIni!=null && c.fechaIni)? ` · SI:${c.saldoIni} ${c.moneda||""} @${c.fechaIni}` : "";
      el.textContent = `${c.nombre} · ${c.tipo} · ${c.multi?`multi: ${c.subMonedas.join(",")}`:c.moneda}${si} · ${c.incluyeCaja?"incluye caja":"no caja"}`;
      list.appendChild(el);
    }
  });
  // selects movimientos
  const deb = $("movDeb"), cred = $("movCred");
  [deb,cred].forEach(sel=>{
    if(!sel) return;
    sel.innerHTML = "";
    state.cuentas.forEach(c=>{
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.nombre + (c.multi? ` (${c.subMonedas.join(",")})` : (c.moneda? ` (${c.moneda})`:""));
      sel.appendChild(o);
    });
  });
}
function renderMovs(){
  const box = $("listaMovs"); if(!box) return;
  if(!state.movs.length){ box.textContent="(vacío)"; return; }
  box.innerHTML = "";
  [...state.movs].slice(-10).reverse().forEach(m=>{
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `<div><strong>${m.fecha}</strong> — ${m.desc} — ${m.monto} ${m.moneda}</div>
    <div class="muted">Débito: ${nombreCuenta(m.deb)} → Crédito: ${nombreCuenta(m.cred)} ${m.cat?` · ${m.cat}`:""} ${m.tag?` · #${m.tag}`:""}</div>`;
    box.appendChild(div);
  });
}
function nombreCuenta(id){
  const c = state.cuentas.find(x=>x.id===id);
  return c? c.nombre : "(?)";
}

// ========= ACCIONES =========
function addMoneda(){
  const code = $("monCode").value.trim().toUpperCase();
  const name = $("monName").value.trim();
  const isCrypto = $("monIsCrypto").value==="Sí";
  const rate = $("monRate").value ? Number($("monRate").value) : null;
  if(!code || !name) return alert("Completá código y nombre.");
  if(state.monedas.some(m=>m.code===code)) return alert("Ya existe esa moneda.");
  state.monedas.push({code, name, isCrypto, rate});
  saveVault().then(()=>{ renderMonedas(); });
  $("monCode").value=""; $("monName").value=""; $("monRate").value=""; $("monIsCrypto").value="No";
}
function addCuenta(){
  const nombre = $("ctaNombre").value.trim();
  const tipo = $("ctaTipo").value;
  const multi = $("ctaMulti").value==="Sí";
  const incluyeCaja = $("ctaIncluyeCaja").value==="Sí";
  const moneda = $("ctaMoneda").value || "ARS";
  const subMonedas = $("ctaSubMonedas").value.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
  const saldoIni = $("ctaSaldoIni").value ? Number($("ctaSaldoIni").value) : null;
  const fechaIni = $("ctaFechaIni").value || null;
  if(!nombre) return alert("Poné un nombre de cuenta.");
  if(multi && subMonedas.length===0) return alert("Indicá subcuentas de moneda (ej. ARS,USD)");
  if(saldoIni!=null && !fechaIni) return alert("Indicá la fecha del saldo inicial.");
  const id = `cta_${Date.now()}`;
  state.cuentas.push({
    id, nombre, tipo, multi, incluyeCaja,
    moneda: multi? null: moneda,
    subMonedas: multi? subMonedas: [],
    saldoIni: multi? saldoIni : saldoIni, // (MVP: un SI general)
    fechaIni
  });
  saveVault().then(()=>{ renderCuentas(); });
  $("ctaNombre").value=""; $("ctaSubMonedas").value=""; $("ctaSaldoIni").value=""; $("ctaFechaIni").value="";
}
function addMovimiento(){
  const fecha = $("movFecha").value || todayISO();
  const desc = $("movDesc").value.trim();
  const monto = Number($("movMonto").value);
  const moneda = $("movMoneda").value;
  const deb = $("movDeb").value;
  const cred = $("movCred").value;
  const cat = $("movCat").value.trim();
  const tag = $("movTag").value.trim();
  if(!desc) return alert("Descripción requerida.");
  if(!monto || monto<=0) return alert("Monto inválido.");
  if(!deb || !cred) return alert("Seleccioná cuentas débito y crédito.");
  if(deb === cred) return alert("Las cuentas no pueden ser iguales.");
  state.movs.push({id:`mov_${Date.now()}`, fecha, desc, monto, moneda, deb, cred, cat, tag});
  saveVault().then(()=>{ renderMovs(); $("movDesc").value=""; $("movMonto").value=""; $("movCat").value=""; $("movTag").value=""; });
}

// ========= CALENDARIO =========
// Construye saldos diarios por cuenta desde su saldo inicial, aplicando movimientos que coinciden en MONEDA y en el rango.
function buildCalendar(startISO, days){
  // armar arreglo de fechas
  const start = new Date(startISO);
  start.setHours(0,0,0,0);
  const dates = Array.from({length:days}, (_,i)=>{ const d=new Date(start); d.setDate(d.getDate()+i); return toISO(d); });

  // mapa cuentas -> saldos por día
  const rows = state.cuentas.map(c=>{
    // saldo inicial y fecha base
    const si = (c.saldoIni!=null) ? Number(c.saldoIni) : 0;
    const fi = c.fechaIni || dates[0];
    // sólo tomamos moneda de cuenta si es mono; si es multi, usamos la "moneda principal" (MVP)
    const mon = c.multi ? (c.subMonedas[0] || "ARS") : (c.moneda || "ARS");

    // base: desde fechaIni hasta fin, inicializamos con SI en fi y “carry-forward”
    const balanceByDate = new Map();
    // prellenar con 0 hasta fi-1
    dates.forEach(d=>balanceByDate.set(d, 0));
    // aplicar SI desde fi
    let running = 0;
    dates.forEach(d=>{
      if(d < fi){ balanceByDate.set(d, 0); }
      else if(d === fi){ running = si; balanceByDate.set(d, running); }
      else{ balanceByDate.set(d, running); }
    });

    // aplicar movimientos por fecha/moneda
    const relevantMovs = state.movs.filter(m=> m.moneda===mon && m.fecha>=dates[0] && m.fecha<=dates[dates.length-1] && (m.deb===c.id || m.cred===c.id));
    // acumulamos por fecha
    const byDay = {};
    relevantMovs.forEach(m=>{
      const delta = (m.cred===c.id ? +m.monto : (m.deb===c.id ? -m.monto : 0));
      byDay[m.fecha] = (byDay[m.fecha]||0) + delta;
    });

    // recorre fechas y suma cambios
    running = balanceByDate.get(dates[0]);
    dates.forEach((d,idx)=>{
      if(idx===0){
        // si primera fecha < fi, queda 0, si igual o mayor ya seteado arriba
      }else{
        running = balanceByDate.get(dates[idx-1]);
      }
      const change = byDay[d]||0;
      const newBal = ( (d < fi) ? 0 : running ) + ((d < fi) ? 0 : change);
      balanceByDate.set(d, newBal);
    });

    return {
      cuentaId: c.id,
      nombre: c.nombre + (c.multi? ` (${mon})` : (c.moneda? ` (${c.moneda})`:"")),
      moneda: mon,
      series: dates.map(d=> balanceByDate.get(d))
    };
  });

  return {dates, rows};
}
function renderCalendar(){
  const start = $("calInicio").value || todayISO();
  const days = Number($("calRango").value || "30");
  const {dates, rows} = buildCalendar(start, days);
  const tbl = $("calTabla");
  if(!tbl) return;
  // header
  let html = "<thead><tr><th>Cuenta</th>";
  dates.forEach(d=> html += `<th>${d}</th>`);
  html += "</tr></thead><tbody>";
  // rows
  rows.forEach(r=>{
    html += `<tr><td>${r.nombre}</td>`;
    r.series.forEach(v=> html += `<td>${(v!=null)? v.toLocaleString(): ""}</td>`);
    html += "</tr>";
  });
  html += "</tbody>";
  tbl.innerHTML = html;
}

// ========= TABS & WIRING =========
function switchTab(id){
  ["tab-cuentas","tab-monedas","tab-mov","tab-cal","tab-export"].forEach(t=>{
    const el = document.getElementById(t);
    if(el) el.style.display = (t===id)?"block":"none";
  });
}
function wireEventsOnce(){
  // tabs
  [["tabBtnCtas","tab-cuentas"],["tabBtnMon","tab-monedas"],["tabBtnMov","tab-mov"],["tabBtnCal","tab-cal"],["tabBtnExp","tab-export"]]
    .forEach(([btn,tab])=>{ const b=$(btn); if(b) b.addEventListener("click", ()=>switchTab(tab)); });
  // acciones
  [["btnAddMoneda",addMoneda],["btnAddCuenta",addCuenta],["btnAddMov",addMovimiento],["btnExport",exportVault],["btnImport",importVault],["btnCalcular",renderCalendar]]
    .forEach(([id,fn])=>{ const el=$(id); if(el) el.addEventListener("click", fn); });
  // import input
  const fi = $("fileImport");
  if(fi){
    fi.addEventListener("change", async (e)=>{
      const file = e.target.files[0]; if(!file) return;
      const text = await file.text();
      try{
        const pack = JSON.parse(text);
        await decryptJson(pack, currentPin); // test
        localStorage.setItem(vaultKeyFor(currentUser), text);
        await loadVault(currentUser, currentPin);
        renderMonedas(); renderCuentas(); renderMovs(); renderCalendar();
        alert("Importado OK");
      }catch(err){ console.error(err); alert("No se pudo importar (PIN/archivo incorrecto)."); }
      finally{ e.target.value=""; }
    });
  }
}
async function exportVault(){
  await saveVault();
  const blob = new Blob([localStorage.getItem(vaultKeyFor(currentUser))], {type:"application/json"});
  const a = document.createElement("a");
  const filename = `gastosapp_${currentUser}_${ts()}.gastosapp`;
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  const info = $("exportInfo"); if(info) info.textContent = `Exportado: ${filename}`;
}
function importVault(){ const f=$("fileImport"); if(f) f.click(); }

// ========= LOGIN =========
$("btnUnlock").addEventListener("click", async ()=>{
  const uid = $("userId").value.trim();
  const pin = $("pin").value.trim();
  if(!uid || pin.length!==4) return alert("Usuario y PIN (4 dígitos).");
  const ok = await loadVault(uid, pin);
  if(!ok) return alert("PIN o usuario inválido.");
  $("authCard").style.display = "none";
  $("app").style.display = "block";
  $("movFecha").value = todayISO();
  $("calInicio").value = todayISO();
  wireEventsOnce();
  renderMonedas(); renderCuentas(); renderMovs(); renderCalendar();
});
$("btnReset").addEventListener("click", ()=>{
  if(confirm("Esto borra los datos locales del usuario actual. ¿Continuar?")){
    const uid = $("userId").value.trim();
    if(uid){ localStorage.removeItem(vaultKeyFor(uid)); }
    state = null; currentPin=null; currentUser=null;
    alert("Reiniciado. Volvé a ingresar con Usuario + PIN.");
    location.reload();
  }
});

// Prefill último usuario
const last = localStorage.getItem(LAST_USER_KEY);
if(last){ $("userId").value = last; }
