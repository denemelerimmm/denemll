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

// Extend auth with roles and presence
auth.roles = storage.get('roles', {}) // { email: 'admin' | 'user' }
auth.presence = storage.get('presence', {}) // { email: timestampISO }
auth.revenue = storage.get('revenue', []) // [{email, amount, at}]
function saveAdminStores(){ storage.set('roles', auth.roles); storage.set('presence', auth.presence); storage.set('revenue', auth.revenue) }

// Mark current user online on activity
function heartbeat(){ if(!isLoggedIn()) return; auth.presence[auth.session.email] = new Date().toISOString(); saveAdminStores(); renderAdmin() }
['click','keydown','mousemove','touchstart','visibilitychange'].forEach(ev=>document.addEventListener(ev, heartbeat, { passive:true }))
setInterval(heartbeat, 15000)

function getMetrics(){
  const users = auth.users.length
  const today = new Date().toISOString().slice(0,10)
  const todaySignups = auth.users.filter(u => (u.createdAt||'').slice(0,10) === today).length
  const now = Date.now()
  const online = Object.values(auth.presence).filter(ts => now - new Date(ts).getTime() < 60_000).length
  const revenue = auth.revenue.reduce((s,r)=> s + Number(r.amount||0), 0)
  return { users, todaySignups, online, revenue }
}

function renderAdmin(){
  const m = getMetrics()
  const fmt = (n)=> new Intl.NumberFormat('tr-TR', { style:'currency', currency:'TRY', maximumFractionDigits:2 }).format(n)
  const MU=$('#mUsers'), MT=$('#mTodaySignups'), MO=$('#mOnline'), MR=$('#mRevenue')
  if(MU) MU.textContent = String(m.users)
  if(MT) MT.textContent = String(m.todaySignups)
  if(MO) MO.textContent = String(m.online)
  if(MR) MR.textContent = fmt(m.revenue)
  const list = $('#revenueList'); if(list){ list.innerHTML=''; auth.revenue.slice(-20).reverse().forEach(r=>{ const li=document.createElement('li'); li.innerHTML=`<div><strong>${r.email}</strong><div class="meta">${new Date(r.at).toLocaleString('tr-TR')}</div></div><div>${fmt(r.amount)}</div>`; list.appendChild(li) }) }
  const isAdmin = auth.roles[auth.session.email] === 'admin'
  $$('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin))
  if (isAdmin) renderAdminStories()
}

$('#addRevenue')?.addEventListener('click', () => {
  const email = ($('#revEmail').value||'').trim().toLowerCase()
  const amount = Number($('#revAmount').value||0)
  if (!email || !(amount>0)) return
  auth.revenue.push({ email, amount, at: new Date().toISOString() })
  saveAdminStores(); renderAdmin()
})

// Ensure first registered user is admin
if (auth.users.length>0 && !Object.values(auth.roles).some(r=>r==='admin')){
  auth.roles[auth.users[0].email] = 'admin'; saveAdminStores()
}

// App state (per user)
const state = {
  settings: { quitDate: '', dailyGoal: '', motivations: '' },
  checkins: [],
  triggers: [],
  urges: [],
  notes: { quick: '', sos: '' }
}

// Stories state per user
state.stories = storage.get(keyFor('stories'), []) // [{id,type:'video'|'text',title,url?,content?,addedAt}]

function saveAll(){
  storage.set(keyFor('settings'), state.settings)
  storage.set(keyFor('checkins'), state.checkins)
  storage.set(keyFor('triggers'), state.triggers)
  storage.set(keyFor('urges'), state.urges)
  storage.set(keyFor('notes'), state.notes)
  storage.set(keyFor('stories'), state.stories)
}

function hydrateFromStorage(){
  state.settings = storage.get(keyFor('settings'), { quitDate: '', dailyGoal: '', motivations: '' })
  state.checkins = storage.get(keyFor('checkins'), [])
  state.triggers = storage.get(keyFor('triggers'), [])
  state.urges = storage.get(keyFor('urges'), [])
  state.notes = storage.get(keyFor('notes'), { quick: '', sos: '' })
  state.stories = storage.get(keyFor('stories'), [])
}

// Quit date inline update on dashboard
$('#saveQuitDateDash')?.addEventListener('click', () => {
  const val = $('#quitDateDash').value || ''
  state.settings.quitDate = val
  saveAll(); updateDashboard(); loadSettingsUI()
})

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
    if (Array.isArray(data.stories)) state.stories = data.stories
    saveAll(); loadSettingsUI(); renderAll(); alert('Veriler içe aktarıldı.')
  } catch { alert('Geçersiz dosya.') }
})

// API helper
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || ''
async function api(path, options={}){
  if (!API_BASE) throw new Error('API_BASE yok')
  const headers = { 'Content-Type': 'application/json', ...(auth.apiToken? { Authorization: `Bearer ${auth.apiToken}` } : {}) }
  const res = await fetch(API_BASE + path, { ...options, headers })
  const data = await res.json().catch(()=>({}))
  if (!res.ok) throw new Error(data?.error || 'api_error')
  return data
}

// Extend auth with API token/current user
auth.apiToken = storage.get('api_token', '')
auth.currentUser = storage.get('current_user', null)
function setSession({ token, user }){ auth.apiToken = token; auth.currentUser = user; auth.session.email = user.email; saveAuth(); storage.set('api_token', token); storage.set('current_user', user) }
function clearSession(){ auth.apiToken=''; auth.currentUser=null; auth.session.email=''; saveAuth(); storage.set('api_token',''); storage.set('current_user', null) }

function isLoggedIn(){ return !!(auth.apiToken || auth.session.email) }

function isAdmin(){ return (auth.currentUser && auth.currentUser.role==='admin') || auth.roles[auth.session.email]==='admin' }

function updateAuthUI(){
  const logged = isLoggedIn()
  $$('.guest-only').forEach(el => el.classList.toggle('hidden', logged))
  $$('.auth-only').forEach(el => el.classList.toggle('hidden', !logged))
  $$('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin()))
  if (logged) { selectTab('dashboard') } else { selectTab('login') }
}

// Override login/register to use API when configured
$('#loginBtn')?.addEventListener('click', async () => {
  const email = ($('#loginEmail').value||'').trim().toLowerCase()
  const pass = $('#loginPassword').value||''
  const err = $('#loginError'); if(err){ err.hidden=true; err.textContent='' }
  try{
    if (API_BASE){
      const data = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email, password: pass }) })
      setSession(data)
    } else {
      const user = auth.users.find(u=>u.email===email)
      const ok = user && user.passwordHash === await sha256(pass)
      if (!ok) throw new Error('invalid_credentials')
      auth.session.email = email; saveAuth()
    }
    hydrateFromStorage(); renderAll(); updateAuthUI()
  }catch(e){ if(err){ err.textContent='E-posta veya parola hatalı.'; err.hidden=false } }
})

$('#registerBtn')?.addEventListener('click', async () => {
  const email = ($('#registerEmail').value||'').trim().toLowerCase()
  const p1 = $('#registerPassword').value||''
  const p2 = $('#registerPassword2').value||''
  const err = $('#registerError'); if(err){ err.hidden=true; err.textContent='' }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ if(err){ err.textContent='Geçerli bir e-posta girin.'; err.hidden=false } return }
  if (p1.length < 6){ if(err){ err.textContent='Parola en az 6 karakter olmalı.'; err.hidden=false } return }
  if (p1 !== p2){ if(err){ err.textContent='Parolalar eşleşmiyor.'; err.hidden=false } return }
  try{
    if (API_BASE){
      const data = await api('/api/auth/register', { method:'POST', body: JSON.stringify({ email, password: p1 }) })
      setSession(data)
    } else {
      if (auth.users.some(u=>u.email===email)){ if(err){ err.textContent='Bu e-posta ile kayıt mevcut.'; err.hidden=false } return }
      auth.users.push({ email, passwordHash: await sha256(p1), createdAt: new Date().toISOString() })
      auth.session.email = email; saveAuth()
    }
    hydrateFromStorage(); saveAll(); renderAll(); updateAuthUI()
  }catch(e){ if(err){ err.textContent = e.message==='email_exists'?'Bu e-posta kayıtlı.':'Kayıt başarısız.'; err.hidden=false } }
})

// Forgot/Reset
$('#showForgot')?.addEventListener('click', ()=>{ const box=$('#forgotBox'); if(box) box.hidden = !box.hidden })
$('#forgotBtn')?.addEventListener('click', async ()=>{
  const email = ($('#forgotEmail').value||'').trim().toLowerCase()
  const msg=$('#forgotMsg'); if(msg){ msg.hidden=true }
  try{ await api('/api/auth/forgot',{ method:'POST', body: JSON.stringify({ email }) }); if(msg){ msg.hidden=false } }catch{}
})

function checkResetTokenOnLoad(){
  if (!API_BASE) return
  const url = new URL(location.href)
  const token = url.searchParams.get('resetToken')
  if (token){ selectTab('login'); const box=$('#resetBox'); if(box) box.hidden=false; $('#resetBtn')?.addEventListener('click', async ()=>{
      const p1=$('#resetPass1').value||''; const p2=$('#resetPass2').value||''; const msg=$('#resetMsg')
      if (p1.length<6 || p1!==p2) return
      try{ await api('/api/auth/reset',{ method:'POST', body: JSON.stringify({ token, password: p1 }) }); if(msg){ msg.hidden=false } }catch{}
    })
  }
}

$('#logoutBtn')?.addEventListener('click', () => {
  clearSession(); hydrateFromStorage(); renderAll(); updateAuthUI()
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
function updateDashboard(){
  updateTodayGoal();
  const quit = state.settings.quitDate
  const d=$('#daysSinceQuit'); if(d) d.textContent = quit? daysBetween(quit,new Date()) : 0
  const qd=$('#quitDateDisplay'); if(qd) qd.textContent = quit || '—'
  const qdi=$('#quitDateDash'); if(qdi && quit) qdi.value = quit
  const sorted=[...state.checkins].sort((a,b)=>b.date.localeCompare(a.date)); let streak=0; let cursor=formatYMD(new Date());
  for(const c of sorted){ if(c.date===cursor && c.success!==false){ streak++; cursor=formatYMD(new Date(new Date(cursor).getTime()-86400000)) } else if (c.date>cursor){ continue } else { break } }
  const s=$('#streakDays'); if(s) s.textContent=streak
}

// Stories logic
function toYouTubeEmbed(url){
  try{
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')){ return `https://www.youtube.com/embed/${u.pathname.replace('/', '')}` }
    if (u.hostname.includes('youtube.com')){
      if (u.pathname.startsWith('/watch')){ const id=u.searchParams.get('v'); if(id) return `https://www.youtube.com/embed/${id}` }
      if (u.pathname.startsWith('/shorts/')){ const id=u.pathname.split('/')[2]; if(id) return `https://www.youtube.com/embed/${id}` }
    }
  }catch{}
  return ''
}

// Global shared stores (admin-managed)
const globalStore = {
  stories: storage.get('global:stories', []) // shared across users
}
function saveGlobal(){ storage.set('global:stories', globalStore.stories) }

// Remove per-user stories usage; render dashboard from global
function renderStories(){
  const videoC = $('#storiesVideo'); const textC = $('#storiesText')
  if(!videoC || !textC) return
  videoC.innerHTML=''; textC.innerHTML=''
  // pick up to 3 random items per type
  const videos = globalStore.stories.filter(s=>s.type==='video')
  const texts = globalStore.stories.filter(s=>s.type==='text')
  const pick = (arr, n)=> arr.slice().sort(()=>Math.random()-0.5).slice(0, Math.min(n, arr.length))
  pick(videos, 3).forEach(s=>{
    const wrap = document.createElement('div')
    const embed = toYouTubeEmbed(s.url||'')
    if (embed){ wrap.innerHTML = `<div class="video"><iframe src="${embed}?rel=0" allowfullscreen loading="lazy"></iframe></div><div class="meta" style="margin-top:6px">${s.title||''}</div>` }
    else { wrap.innerHTML = `<div><a class="meta" target="_blank" rel="noopener" href="${s.url}">${s.title||s.url}</a></div>` }
    videoC.appendChild(wrap)
  })
  pick(texts, 3).forEach(s=>{
    const div = document.createElement('div'); div.className='card'
    div.innerHTML = `<strong>${s.title||'Hikaye'}</strong><div class="meta" style="margin-top:6px">${(s.content||'').replace(/</g,'&lt;')}</div>`
    textC.appendChild(div)
  })
}

// Admin panel for stories
$('#adminStoryType')?.addEventListener('change', ()=>{
  const t = $('#adminStoryType').value
  $('#adminStoryUrlField').hidden = t!=='video'
  $('#adminStoryContentField').hidden = t!=='text'
})

// Admin metrics via API when possible
async function renderAdmin(){
  try{
    if (API_BASE && auth.apiToken){
      const m = await api('/api/admin/metrics')
      const fmt = (n)=> new Intl.NumberFormat('tr-TR', { style:'currency', currency:'TRY', maximumFractionDigits:2 }).format(n)
      const MU=$('#mUsers'), MT=$('#mTodaySignups'), MO=$('#mOnline'), MR=$('#mRevenue')
      if(MU) MU.textContent = String(m.users)
      if(MT) MT.textContent = String(m.todaySignups)
      if(MO) MO.textContent = String(m.online)
      if(MR) MR.textContent = fmt(m.revenue)
    }
  }catch{}
  const isAdminFlag = isAdmin(); $$('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdminFlag))
  if (isAdminFlag) renderAdminStories()
}

// Stories from API
async function fetchStories(){
  try{
    if (API_BASE){ const res = await api('/api/stories'); globalStore.stories = res.stories || []; renderStories(); if(isAdmin()) renderAdminStories() }
  }catch{}
}

// Admin add/delete stories via API
$('#adminAddStory')?.addEventListener('click', async (e)=>{
  if (!isAdmin()) return
  e.stopImmediatePropagation()
  const type = $('#adminStoryType').value
  const title = ($('#adminStoryTitle').value||'').trim()
  const url = ($('#adminStoryUrl').value||'').trim()
  const content = ($('#adminStoryContent').value||'').trim()
  try{
    if (API_BASE && auth.apiToken){ await api('/api/stories',{ method:'POST', body: JSON.stringify({ type, title, url, content }) }); await fetchStories() }
    else { // fallback local
      const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now())
      globalStore.stories.unshift({ id, type, title, url, content, addedAt: new Date().toISOString(), by: auth.session.email }); saveGlobal(); renderAdminStories(); renderStories()
    }
  }catch{}
})

function bindDeleteStoryButtons(){
  $$('[data-del-story]')?.forEach(btn=> btn.addEventListener('click', async () => {
    const id = btn.getAttribute('data-del-story')
    try{ if (API_BASE && auth.apiToken){ await api('/api/stories/'+id,{ method:'DELETE' }); await fetchStories() } else { globalStore.stories = globalStore.stories.filter(s=>s.id!==id); saveGlobal(); renderAdminStories(); renderStories() } }catch{}
  }))
}

function renderAdminStories(){
  const list = $('#adminStoriesList'); if(!list) return; list.innerHTML=''
  globalStore.stories.slice(0,100).forEach(s=>{
    const li = document.createElement('li')
    const meta = new Date(s.addedAt).toLocaleString('tr-TR')
    li.innerHTML = `<div>
      <div><strong>${s.title||'(başlık yok)'}</strong> <span class="badge">${s.type}</span></div>
      <div class="meta">${s.by||''} · ${meta}${s.url? ' · '+s.url: ''}</div>
    </div>
    <div class="actions"><button class="btn ghost" data-del-story="${s.id}">Sil</button></div>`
    list.appendChild(li)
  })
  bindDeleteStoryButtons()
}

// Stories UI events
$$('[data-stories-tab]').forEach(btn=>btn.addEventListener('click',()=>{
  const t = btn.getAttribute('data-stories-tab')
  $$('#dashboard .tab.small').forEach(b=>b.classList.toggle('active', b===btn))
  $('#storiesVideo').hidden = t!=='video'
  $('#storiesText').hidden = t!=='text'
}))

$('#storyType')?.addEventListener('change', () => {
  const t = $('#storyType').value
  $('#storyUrlField').hidden = t!=='video'
  $('#storyContentField').hidden = t!=='text'
})

$('#addStory')?.addEventListener('click', () => {
  const type = $('#storyType').value
  const title = ($('#storyTitle').value||'').trim()
  const url = ($('#storyUrl').value||'').trim()
  const content = ($('#storyContent').value||'').trim()
  if (type==='video' && !url) return
  if (type==='text' && !content) return
  const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now())
  state.stories.unshift({ id, type, title, url, content, addedAt: new Date().toISOString() })
  saveAll(); renderStories(); $('#storyTitle').value=''; $('#storyUrl').value=''; $('#storyContent').value=''
})

// SVG helpers for charts
function svgEl(name, attrs={}){ const el=document.createElementNS('http://www.w3.org/2000/svg', name); for(const [k,v] of Object.entries(attrs)){ el.setAttribute(k, String(v)) } return el }
function renderBars(containerId, values, colors){
  const el = document.getElementById(containerId); if(!el) return; el.innerHTML=''
  const w = el.clientWidth || 320, h = el.clientHeight || 160, pad=16
  const svg = svgEl('svg', { viewBox:`0 0 ${w} ${h}`, preserveAspectRatio:'none' })
  // grid
  for(let i=0;i<4;i++){ const y=pad + (h-2*pad)*i/3; svg.appendChild(svgEl('line',{x1:pad,y1:y,x2:w-pad,y2:y,class:'gridline'})) }
  const max = Math.max(1, ...values)
  const bw = (w-2*pad)/values.length
  values.forEach((v, i) => {
    const x = pad + i*bw + bw*0.1
    const bh = (h-2*pad) * (v/max)
    const y = h - pad - bh
    const rect = svgEl('rect', { x, y, width:bw*0.8, height:Math.max(2,bh), class:'bar', fill: colors?.[i] || '#22c55e' })
    svg.appendChild(rect)
  })
  el.appendChild(svg)
}
function renderLine(containerId, values){
  const el = document.getElementById(containerId); if(!el) return; el.innerHTML=''
  const w = el.clientWidth || 320, h = el.clientHeight || 160, pad=16
  const svg = svgEl('svg', { viewBox:`0 0 ${w} ${h}`, preserveAspectRatio:'none' })
  // gradient
  const defs = svgEl('defs'); const grad = svgEl('linearGradient',{id:'gradLine',x1:'0',x2:'1',y1:'0',y2:'0'})
  grad.appendChild(svgEl('stop',{offset:'0%','stop-color':'#38bdf8'})); grad.appendChild(svgEl('stop',{offset:'100%','stop-color':'#22c55e'})); defs.appendChild(grad); svg.appendChild(defs)
  for(let i=0;i<4;i++){ const y=pad + (h-2*pad)*i/3; svg.appendChild(svgEl('line',{x1:pad,y1:y,x2:w-pad,y2:y,class:'gridline'})) }
  const n = values.length; const max = Math.max(1, ...values)
  const pts = values.map((v,i)=>{ const x=pad + (w-2*pad)*(i/(Math.max(1,n-1))); const y=h-pad - (h-2*pad)*(v/max); return [x,y] })
  const d = pts.map(([x,y],i)=> (i? 'L':'M')+x+','+y ).join(' ')
  svg.appendChild(svgEl('path',{ d, class:'line' }))
  pts.forEach(([x,y])=> svg.appendChild(svgEl('circle',{cx:x, cy:y, r:3, class:'dot'})))
  el.appendChild(svg)
}
function renderDonut(containerId, value, total){
  const el = document.getElementById(containerId); if(!el) return; el.innerHTML=''
  const w=el.clientWidth||240, h=el.clientHeight||180, r=Math.min(w,h)/2 - 16, cx=w/2, cy=h/2
  const svg = svgEl('svg',{ viewBox:`0 0 ${w} ${h}`, preserveAspectRatio:'none' })
  const bg = svgEl('circle',{ cx, cy, r, fill:'none', stroke:'#1f2937', 'stroke-width':14 })
  svg.appendChild(bg)
  const frac = total>0? value/total : 0
  const circ = 2*Math.PI*r
  const fg = svgEl('circle',{ cx, cy, r, fill:'none', stroke:'#22c55e', 'stroke-width':14, 'stroke-dasharray':`${circ*frac} ${circ*(1-frac)}`, 'transform':`rotate(-90 ${cx} ${cy})` })
  svg.appendChild(fg)
  const txt = svgEl('text',{ x:cx, y:cy+4, 'text-anchor':'middle', fill:'#e2e8f0', 'font-size':18 })
  txt.textContent = total>0 ? Math.round(frac*100)+'%' : '—'
  svg.appendChild(txt)
  el.appendChild(svg)
}

function renderCharts(){
  // Bars: last 7 days check-ins
  const today = new Date(); const dates=[]; for(let i=6;i>=0;i--){ const d=new Date(today); d.setDate(today.getDate()-i); dates.push(formatYMD(d)) }
  const colors=[]; const values = dates.map(d=>{ const c=state.checkins.find(x=>x.date===d); if(!c){ colors.push('#334155'); return 0.2 } if (c.success===false){ colors.push('#ef4444'); return 0.6 } colors.push('#22c55e'); return 1 })
  renderBars('chartCheckins', values, colors)

  // Line: last up to 7 urge durations
  const urges = state.urges.slice(0,7).map(u=>Math.max(1, Math.round(u.durationSec||0)))
  renderLine('chartUrges', urges.reverse())

  // Donut: success ratio
  const total = state.checkins.length
  const success = state.checkins.filter(c=>c.success===true).length
  renderDonut('chartDonut', success, total)
}

function renderAll(){ renderCheckins(); renderTriggers(); renderUrges(); updateDashboard(); loadSettingsUI(); renderStories(); renderCharts() }

// Init
hydrateFromStorage(); renderAll(); updateAuthUI(); updateTimer(); checkResetTokenOnLoad(); fetchStories();