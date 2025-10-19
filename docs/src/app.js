// ===== Utiles de cifrado con Web Crypto (AES-GCM + PBKDF2) =====
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
// ===== Estado persistente (vault cifrado en localStorage) =====
const LS_KEY = "gastosapp_vault";
const defaultState = () => ({
  meta: {createdAt: new Date().toISOString(), version: 1},
  user: {id: "", pinSet: false},
  monedas: [
    {code:"ARS", name:"Pesos", isCrypto:false, rate:1},
    {code:"USD", name:"Dólares", isCrypto:false, rate:null},
    {code:"BTC", name:"Bitcoin", isCrypto:true, rate:null},
    {code:"ETH", name:"Ethereum", isCrypto:true, rate:null},
    {code:"DOGE", name:"Dogecoin", isCrypto:true, rate:null},
  ],
  cuentas: [] // {id, nombre, tipo, multi, incluyeCaja, moneda, subMonedas[]}
});
let state = defaultState();
let currentPin = null;

function $(id){ return document.getElementById(id); }
function ts(){ return new Date().toISOString().replace(/[:.]/g,"-"); }

async function loadVault(userId, pin){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw){
    state = defaultState();
    state.user.id = userId;
    state.user.pinSet = true;
    currentPin = pin;
    await saveVault();
    return true;
  }
  try{
    const pack = JSON.parse(raw);
    const s = await decryptJson(pack, pin);
    if(s.user.id !== userId) throw new Error("Usuario distinto");
    state = s; currentPin = pin;
    return true;
  }catch(e){
    console.error(e);
    return false;
  }
}
async function saveVault(){
  const pack = await encryptJson(state, currentPin);
  localStorage.setItem(LS_KEY, JSON.stringify(pack));
}

function renderMonedas(){
  const list = $("listaMonedas");
  list.innerHTML = "";
  state.monedas.forEach(m=>{
    const el = document.createElement("div");
    el.className = "pill";
    el.textContent = `${m.code} · ${m.name}${m.rate?` · TC:${m.rate}`:""}`;
    list.appendChild(el);
  });
  // llenar selects
  const sel = $("ctaMoneda");
  sel.innerHTML = "";
  state.monedas.forEach(m=>{
    const opt = document.createElement("option");
    opt.value = m.code; opt.textContent = `${m.code}`;
    sel.appendChild(opt);
  });
}
function renderCuentas(){
  const list = $("listaCuentas");
  list.innerHTML = "";
  state.cuentas.forEach(c=>{
    const el = document.createElement("div");
    el.className = "pill";
    el.textContent = `${c.nombre} · ${c.tipo} · ${c.multi?"multi: "+c.subMonedas.join(","):c.moneda} · ${c.incluyeCaja?"incluye caja":"no caja"}`;
    list.appendChild(el);
  });
}

function addMoneda(){
  const code = $("monCode").value.trim().toUpperCase();
  const name = $("monName").value.trim();
  const isCrypto = $("monIsCrypto").value==="Sí";
  const rate = $("monRate").value ? Number($("monRate").value) : null;
  if(!code || !name) return alert("Completá código y nombre.");
  if(state.monedas.some(m=>m.code===code)) return alert("Ya existe esa moneda.");
  state.monedas.push({code, name, isCrypto, rate});
  saveVault().then(renderMonedas);
  $("monCode").value=""; $("monName").value=""; $("monRate").value="";
  $("monIsCrypto").value="No";
}

function addCuenta(){
  const nombre = $("ctaNombre").value.trim();
  const tipo = $("ctaTipo").value;
  const multi = $("ctaMulti").value==="Sí";
  const incluyeCaja = $("ctaIncluyeCaja").value==="Sí";
  const moneda = $("ctaMoneda").value || "ARS";
  const subMonedas = $("ctaSubMonedas").value.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean);
  if(!nombre) return alert("Poné un nombre de cuenta.");
  if(multi && subMonedas.length===0) return alert("Indicá subcuentas de moneda (ej. ARS,USD)");
  const id = `cta_${Date.now()}`;
  state.cuentas.push({id, nombre, tipo, multi, incluyeCaja, moneda: multi? null: moneda, subMonedas: multi? subMonedas: []});
  saveVault().then(renderCuentas);
  $("ctaNombre").value=""; $("ctaSubMonedas").value="";
}

function switchTab(id){
  ["tab-cuentas","tab-monedas","tab-export"].forEach(t=>{
    document.getElementById(t).style.display = (t===id)?"block":"none";
  });
}

async function exportVault(){
  await saveVault();
  const blob = new Blob([localStorage.getItem(LS_KEY)], {type:"application/json"});
  const a = document.createElement("a");
  const filename = `gastosapp_${ts()}.gastosapp`;
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  $("exportInfo").textContent = `Exportado: ${filename}`;
}
function importVault(){
  $("fileImport").click();
}
$("fileImport").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const text = await file.text();
  try{
    const pack = JSON.parse(text);
    // prueba de descifrado antes de guardar
    await decryptJson(pack, currentPin);
    localStorage.setItem(LS_KEY, text);
    await loadVault(state.user.id, currentPin);
    renderMonedas(); renderCuentas();
    alert("Importado OK");
  }catch(err){
    console.error(err);
    alert("No se pudo importar (PIN/archivo incorrecto).");
  }finally{
    e.target.value = "";
  }
});

// ===== Auth y UI inicial =====
$("btnUnlock").onclick = async ()=>{
  const uid = $("userId").value.trim();
  const pin = $("pin").value.trim();
  if(!uid || pin.length!==4) return alert("Usuario y PIN (4 dígitos).");
  const ok = await loadVault(uid, pin);
  if(!ok) return alert("PIN o usuario inválido.");
  $("authCard").style.display = "none";
  $("app").style.display = "block";
  renderMonedas(); renderCuentas();
};
$("btnReset").onclick = ()=>{
  if(confirm("Esto borra todos los datos locales. ¿Continuar?")){
    localStorage.removeItem(LS_KEY);
    state = defaultState();
    alert("Reiniciado. Ingresá nuevamente con Usuario + PIN.");
    location.reload();
  }
};

// Tabs
document.querySelectorAll("nav button").forEach(b=>{
  b.addEventListener("click", ()=>switchTab(b.dataset.tab));
});
