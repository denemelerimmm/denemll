const $ = (q) => document.querySelector(q)
const $$ = (q) => Array.from(document.querySelectorAll(q))

const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback } },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)) }
}

// Auth store
const auth = {
  users: storage.get('users', []), // [{email, passwordHash, createdAt}]
  session: storage.get('session', { email: '' })
}

function isLoggedIn(){ return !!auth.session.email }
function saveAuth(){ storage.set('users', auth.users); storage.set('session', auth.session) }
function keyFor(suffix){ return `${auth.session.email || 'guest'}:${suffix}` }

// App state (per user)
const state = {
  settings: { quitDate: '', dailyGoal: '', motivations: '' },
  checkins: [],
  triggers: [],
  urges: [],
  notes: { quick: '', sos: '' }
}

function hydrateFromStorage(){
  state.settings = storage.get(keyFor('settings'), { quitDate: '', dailyGoal: '', motivations: '' })
  state.checkins = storage.get(keyFor('checkins'), [])
  state.triggers = storage.get(keyFor('triggers'), [])
  state.urges = storage.get(keyFor('urges'), [])
  state.notes = storage.get(keyFor('notes'), { quick: '', sos: '' })
}

function saveAll(){
  storage.set(keyFor('settings'), state.settings)
  storage.set(keyFor('checkins'), state.checkins)
  storage.set(keyFor('triggers'), state.triggers)
  storage.set(keyFor('urges'), state.urges)
  storage.set(keyFor('notes'), state.notes)
}

async function sha256(message){
  const msgUint8 = new TextEncoder().encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b=>b.toString(16).padStart(2,'0')).join('')
}

function formatDate(d){ const dt = typeof d === 'string' ? new Date(d) : d; return dt.toLocaleString('tr-TR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) }
function formatYMD(d){ const dt = typeof d === 'string' ? new Date(d) : d; return dt.toISOString().slice(0,10) }
function daysBetween(a,b){ const ms=Math.abs(new Date(a).setHours(0,0,0,0)-new Date(b).setHours(0,0,0,0)); return Math.floor(ms/86400000) }

// Tabs
$$('.tab').forEach(btn => { btn.addEventListener('click', () => selectTab(btn.dataset.tab)) })
$('[data-tab-jump="urge"]').addEventListener('click', () => selectTab('urge'))
$('#goToCheckin')?.addEventListener('click', () => selectTab('checkin'))

function selectTab(id){ $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===id)); $$('.panel').forEach(p=>p.classList.toggle('active', p.id===id)) }

function updateAuthUI(){
  const logged = isLoggedIn()
  $$('.guest-only').forEach(el => el.classList.toggle('hidden', logged))
  $$('.auth-only').forEach(el => el.classList.toggle('hidden', !logged))
  if (logged) { selectTab('dashboard') } else { selectTab('login') }
}

// Settings
const quitDateInput = $('#quitDate')
const dailyGoalInput = $('#dailyGoal')
const motivationsInput = $('#motivations')
const settingsSaved = $('#settingsSaved')

function loadSettingsUI(){
  if (!quitDateInput) return
  quitDateInput.value = state.settings.quitDate || ''
  dailyGoalInput.value = state.settings.dailyGoal || ''
  motivationsInput.value = state.settings.motivations || ''
  updateTodayGoal(); updateDashboard()
}

$('#saveSettings')?.addEventListener('click', () => {
  state.settings.quitDate = quitDateInput.value || ''
  state.settings.dailyGoal = dailyGoalInput.value.trim()
  state.settings.motivations = motivationsInput.value.trim()
  saveAll(); settingsSaved.hidden=false; setTimeout(()=>settingsSaved.hidden=true,1500); updateDashboard()
})

$('#exportData')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=`kumar-birak-${formatYMD(new Date())}.json`; a.click(); URL.revokeObjectURL(url)
})

$('#importData')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (data.settings) state.settings = data.settings
    if (Array.isArray(data.checkins)) state.checkins = data.checkins
    if (Array.isArray(data.triggers)) state.triggers = data.triggers
    if (Array.isArray(data.urges)) state.urges = data.urges
    if (data.notes) state.notes = data.notes
    saveAll(); loadSettingsUI(); renderAll(); alert('Veriler içe aktarıldı.')
  } catch { alert('Geçersiz dosya.') }
})

$('#logoutBtn')?.addEventListener('click', () => {
  auth.session.email = ''
  saveAuth(); hydrateFromStorage(); renderAll(); updateAuthUI()
})

// Quick note & SOS
$('#quickNote') && ($('#quickNote').value = state.notes.quick || '')
$('#saveQuickNote')?.addEventListener('click', () => { state.notes.quick = $('#quickNote').value.trim(); saveAll() })
$('#clearQuickNote')?.addEventListener('click', () => { state.notes.quick = ''; $('#quickNote').value=''; saveAll() })

$('#sosMessage') && ($('#sosMessage').value = state.notes.sos || '')
$('#copySos')?.addEventListener('click', async () => { state.notes.sos = $('#sosMessage').value.trim(); saveAll(); try { await navigator.clipboard.writeText(state.notes.sos || '') } catch {} })

// Check-ins
$$('[data-checkin]').forEach(btn => btn.addEventListener('click', () => { addCheckin({ success: btn.dataset.checkin==='yes' }) }))
$('#saveCheckin')?.addEventListener('click', () => { const mood=$('#mood').value; const note=$('#checkinNote').value.trim(); addCheckin({ mood, note }); $('#mood').value=''; $('#checkinNote').value='' })

function addCheckin(extra){
  const today = formatYMD(new Date())
  const idx = state.checkins.findIndex(c=>c.date===today)
  const base = { date: today, success: undefined, mood: '', note: '' }
  const entry = { ...(idx>-1?state.checkins[idx]:base), ...extra }
  if (idx>-1) state.checkins[idx]=entry; else state.checkins.unshift(entry)
  saveAll(); renderCheckins(); updateDashboard(); const ok=$('#checkinSaved'); if(ok){ ok.hidden=false; setTimeout(()=>ok.hidden=true,1200) }
}

function renderCheckins(){
  const list = $('#checkinHistory'); if(!list) return; list.innerHTML=''
  state.checkins.slice(0,30).forEach(c=>{ const li=document.createElement('li'); li.innerHTML=`<div><div><strong>${c.success===true?'✅ Başarılı':c.success===false?'⚠️ Zorlandı':'ℹ️ Kayıt'}</strong> <span class="meta">${c.mood||''}</span></div><div class="meta">${c.note?c.note+' · ':''}${c.date}</div></div><div class="meta"></div>`; list.appendChild(li) })
  const w=$('#checkinsThisWeek'); if(w) w.textContent = countCheckinsThisWeek()
}

function countCheckinsThisWeek(){ const now=new Date(); const day=now.getDay(); const monday=new Date(now); monday.setDate(now.getDate()-((day+6)%7)); const start=formatYMD(monday); return state.checkins.filter(c=>c.date>=start).length }

// Triggers
$('#addTrigger')?.addEventListener('click', () => { const type=$('#triggerType').value; const intensity=Number($('#triggerIntensity').value); const note=$('#triggerNote').value.trim(); state.triggers.unshift({ date: formatDate(new Date()), type, intensity, note }); saveAll(); renderTriggers(); $('#triggerNote').value='' })

function renderTriggers(){ const list=$('#triggerList'); if(!list) return; list.innerHTML=''; state.triggers.slice(0,50).forEach(t=>{ const li=document.createElement('li'); li.innerHTML=`<div><div><strong>${t.type}</strong> <span class="badge">${t.intensity}/10</span></div><div class="meta">${t.note||''}</div></div><div class="meta">${t.date}</div>`; list.appendChild(li) }) }

// Urge timer
let urgeSeconds=300, urgeInterval=null; const urgeTimerEl=$('#urgeTimer'), urgeHint=$('#urgeHint')
function fmt(sec){ const m=String(Math.floor(sec/60)).padStart(2,'0'); const s=String(sec%60).padStart(2,'0'); return `${m}:${s}` }
function tick(){ if(urgeSeconds>0){ urgeSeconds--; updateTimer() } else { stopUrge(); if(urgeHint) urgeHint.textContent='Aferin! Dürtüyü atlattın.' } }
function updateTimer(){ if(urgeTimerEl) urgeTimerEl.textContent=fmt(urgeSeconds) }
function startUrge(){ if(urgeInterval) return; urgeInterval=setInterval(tick,1000); if(urgeHint) urgeHint.textContent='Devam…' }
function stopUrge(){ if(!urgeInterval) return; clearInterval(urgeInterval); urgeInterval=null; if(urgeHint) urgeHint.textContent='Durduruldu.' }
function resetUrge(){ stopUrge(); urgeSeconds=300; updateTimer(); if(urgeHint) urgeHint.textContent='Hazır olduğunda başlat.' }
$('#startUrge')?.addEventListener('click', startUrge)
$('#stopUrge')?.addEventListener('click', stopUrge)
$('#resetUrge')?.addEventListener('click', resetUrge)
$('#logUrge')?.addEventListener('click', () => { const duration=300-urgeSeconds; state.urges.unshift({ date: formatDate(new Date()), durationSec: duration }); saveAll(); renderUrges(); resetUrge(); const last=$('#lastUrgeInfo'); if(last) last.textContent=`${duration} sn` })

function renderUrges(){ const list=$('#urgeHistory'); if(!list) return; list.innerHTML=''; state.urges.slice(0,30).forEach(u=>{ const li=document.createElement('li'); li.innerHTML=`<div><div><strong>${Math.round(u.durationSec)} sn</strong></div><div class="meta">${u.date}</div></div><div class="meta"></div>`; list.appendChild(li) }); if(state.urges[0]){ const last=$('#lastUrgeInfo'); if(last) last.textContent=`${Math.round(state.urges[0].durationSec)} sn · ${state.urges[0].date}` } }

// Dashboard
function updateTodayGoal(){ const el=$('#todayGoalText'); if(el) el.textContent = state.settings.dailyGoal || 'Ayarlar\'dan hedef belirleyin.' }
function updateDashboard(){ updateTodayGoal(); const quit=state.settings.quitDate; const d=$('#daysSinceQuit'); if(d) d.textContent = quit? daysBetween(quit,new Date()) : 0; const sorted=[...state.checkins].sort((a,b)=>b.date.localeCompare(a.date)); let streak=0; let cursor=formatYMD(new Date()); for(const c of sorted){ if(c.date===cursor && c.success!==false){ streak++; cursor=formatYMD(new Date(new Date(cursor).getTime()-86400000)) } else if (c.date>cursor){ continue } else { break } } const s=$('#streakDays'); if(s) s.textContent=streak }
function renderAll(){ renderCheckins(); renderTriggers(); renderUrges(); updateDashboard(); loadSettingsUI(); }

// Auth events
$('#loginBtn')?.addEventListener('click', async () => {
  const email = ($('#loginEmail').value||'').trim().toLowerCase()
  const pass = $('#loginPassword').value||''
  const err = $('#loginError'); if(err){ err.hidden=true; err.textContent='' }
  const user = auth.users.find(u=>u.email===email)
  const ok = user && user.passwordHash === await sha256(pass)
  if (!ok){ if(err){ err.textContent='E-posta veya parola hatalı.'; err.hidden=false } return }
  auth.session.email = email; saveAuth(); hydrateFromStorage(); renderAll(); updateAuthUI()
})

$('#registerBtn')?.addEventListener('click', async () => {
  const email = ($('#registerEmail').value||'').trim().toLowerCase()
  const p1 = $('#registerPassword').value||''
  const p2 = $('#registerPassword2').value||''
  const err = $('#registerError'); if(err){ err.hidden=true; err.textContent='' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ if(err){ err.textContent='Geçerli bir e-posta girin.'; err.hidden=false } return }
  if (p1.length < 6){ if(err){ err.textContent='Parola en az 6 karakter olmalı.'; err.hidden=false } return }
  if (p1 !== p2){ if(err){ err.textContent='Parolalar eşleşmiyor.'; err.hidden=false } return }
  if (auth.users.some(u=>u.email===email)){ if(err){ err.textContent='Bu e-posta ile kayıt mevcut.'; err.hidden=false } return }
  auth.users.push({ email, passwordHash: await sha256(p1), createdAt: new Date().toISOString() })
  auth.session.email = email; saveAuth(); hydrateFromStorage(); saveAll(); renderAll(); updateAuthUI()
})

// Init
hydrateFromStorage(); renderAll(); updateAuthUI(); updateTimer()