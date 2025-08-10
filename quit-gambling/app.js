const $ = (q) => document.querySelector(q)
const $$ = (q) => Array.from(document.querySelectorAll(q))

const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)) }
}

const state = {
  settings: storage.get('settings', { quitDate: '', dailyGoal: '', motivations: '' }),
  checkins: storage.get('checkins', []), // [{date:"2025-01-01", success:true, mood, note}]
  triggers: storage.get('triggers', []), // [{date, type, intensity, note}]
  urges: storage.get('urges', []),       // [{date, durationSec}]
  notes: storage.get('notes', { quick: '', sos: '' })
}

function saveAll() {
  storage.set('settings', state.settings)
  storage.set('checkins', state.checkins)
  storage.set('triggers', state.triggers)
  storage.set('urges', state.urges)
  storage.set('notes', state.notes)
}

function formatDate(d) {
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleString('tr-TR', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
}

function formatYMD(d) {
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toISOString().slice(0,10)
}

function daysBetween(a, b) {
  const ms = Math.abs(new Date(a).setHours(0,0,0,0) - new Date(b).setHours(0,0,0,0))
  return Math.floor(ms / 86400000)
}

// Tabs
$$('.tab').forEach(btn => {
  btn.addEventListener('click', () => selectTab(btn.dataset.tab))
})
$('[data-tab-jump="urge"]').addEventListener('click', () => selectTab('urge'))
$('#goToCheckin').addEventListener('click', () => selectTab('checkin'))

function selectTab(id) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id))
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === id))
}

// Settings
const quitDateInput = $('#quitDate')
const dailyGoalInput = $('#dailyGoal')
const motivationsInput = $('#motivations')
const settingsSaved = $('#settingsSaved')

function loadSettingsUI() {
  quitDateInput.value = state.settings.quitDate || ''
  dailyGoalInput.value = state.settings.dailyGoal || ''
  motivationsInput.value = state.settings.motivations || ''
  updateTodayGoal()
  updateDashboard()
}

$('#saveSettings').addEventListener('click', () => {
  state.settings.quitDate = quitDateInput.value || ''
  state.settings.dailyGoal = dailyGoalInput.value.trim()
  state.settings.motivations = motivationsInput.value.trim()
  saveAll()
  settingsSaved.hidden = false
  setTimeout(() => settingsSaved.hidden = true, 1500)
  updateDashboard()
})

// Export / Import
$('#exportData').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kumar-birak-${formatYMD(new Date())}.json`
  a.click(); URL.revokeObjectURL(url)
})

$('#importData').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return
  const text = await file.text()
  try {
    const data = JSON.parse(text)
    if (data.settings) state.settings = data.settings
    if (Array.isArray(data.checkins)) state.checkins = data.checkins
    if (Array.isArray(data.triggers)) state.triggers = data.triggers
    if (Array.isArray(data.urges)) state.urges = data.urges
    if (data.notes) state.notes = data.notes
    saveAll(); loadSettingsUI(); renderAll()
    alert('Veriler içe aktarıldı.')
  } catch { alert('Geçersiz dosya.') }
})

// Quick note
$('#quickNote').value = state.notes.quick || ''
$('#saveQuickNote').addEventListener('click', () => {
  state.notes.quick = $('#quickNote').value.trim(); saveAll()
})
$('#clearQuickNote').addEventListener('click', () => {
  state.notes.quick = ''; $('#quickNote').value=''; saveAll()
})

// SOS message
$('#sosMessage').value = state.notes.sos || ''
$('#copySos').addEventListener('click', async () => {
  state.notes.sos = $('#sosMessage').value.trim(); saveAll()
  try { await navigator.clipboard.writeText(state.notes.sos || '') } catch {}
})

// Check-ins
$$('[data-checkin]').forEach(btn => btn.addEventListener('click', () => {
  const success = btn.dataset.checkin === 'yes'
  addCheckin({ success })
}))
$('#saveCheckin').addEventListener('click', () => {
  const mood = $('#mood').value
  const note = $('#checkinNote').value.trim()
  addCheckin({ mood, note })
  $('#mood').value = ''
  $('#checkinNote').value = ''
})

function addCheckin(extra){
  const today = formatYMD(new Date())
  const existingIdx = state.checkins.findIndex(c => c.date === today)
  const base = { date: today, success: undefined, mood: '', note: '' }
  const entry = { ...(existingIdx>-1? state.checkins[existingIdx]: base), ...extra }
  if (existingIdx>-1) state.checkins[existingIdx] = entry; else state.checkins.unshift(entry)
  saveAll(); renderCheckins(); updateDashboard(); $('#checkinSaved').hidden=false; setTimeout(()=>$('#checkinSaved').hidden=true,1200)
}

function renderCheckins(){
  const list = $('#checkinHistory'); list.innerHTML = ''
  state.checkins.slice(0,30).forEach(c => {
    const li = document.createElement('li')
    li.innerHTML = `
      <div>
        <div><strong>${c.success===true?'✅ Başarılı':c.success===false?'⚠️ Zorlandı':'ℹ️ Kayıt'}</strong> <span class="meta">${c.mood||''}</span></div>
        <div class="meta">${c.note?c.note+' · ':''}${c.date}</div>
      </div>
      <div class="meta"></div>`
    list.appendChild(li)
  })
  $('#checkinsThisWeek').textContent = countCheckinsThisWeek()
}

function countCheckinsThisWeek(){
  const now = new Date(); const day = now.getDay(); // 0 Sun
  const monday = new Date(now); monday.setDate(now.getDate() - ((day+6)%7))
  const start = formatYMD(monday)
  return state.checkins.filter(c => c.date >= start).length
}

// Triggers
$('#addTrigger').addEventListener('click', () => {
  const type = $('#triggerType').value
  const intensity = Number($('#triggerIntensity').value)
  const note = $('#triggerNote').value.trim()
  const entry = { date: formatDate(new Date()), type, intensity, note }
  state.triggers.unshift(entry)
  saveAll(); renderTriggers(); $('#triggerNote').value=''
})

function renderTriggers(){
  const list = $('#triggerList'); list.innerHTML = ''
  state.triggers.slice(0,50).forEach(t => {
    const li = document.createElement('li')
    li.innerHTML = `
      <div>
        <div><strong>${t.type}</strong> <span class="badge">${t.intensity}/10</span></div>
        <div class="meta">${t.note||''}</div>
      </div>
      <div class="meta">${t.date}</div>`
    list.appendChild(li)
  })
}

// Urge timer
let urgeSeconds = 300
let urgeInterval = null
const urgeTimerEl = $('#urgeTimer')
const urgeHint = $('#urgeHint')

function fmt(sec){
  const m = String(Math.floor(sec/60)).padStart(2,'0'); const s = String(sec%60).padStart(2,'0'); return `${m}:${s}`
}
function tick(){
  if (urgeSeconds>0){ urgeSeconds--; updateTimer() } else { stopUrge(); urgeHint.textContent = 'Aferin! Dürtüyü atlattın.' }
}
function updateTimer(){ urgeTimerEl.textContent = fmt(urgeSeconds) }
function startUrge(){ if(urgeInterval) return; urgeInterval = setInterval(tick,1000); urgeHint.textContent='Devam…' }
function stopUrge(){ if(!urgeInterval) return; clearInterval(urgeInterval); urgeInterval=null; urgeHint.textContent='Durduruldu.' }
function resetUrge(){ stopUrge(); urgeSeconds=300; updateTimer(); urgeHint.textContent='Hazır olduğunda başlat.' }

$('#startUrge').addEventListener('click', startUrge)
$('#stopUrge').addEventListener('click', stopUrge)
$('#resetUrge').addEventListener('click', resetUrge)

$('#logUrge').addEventListener('click', () => {
  const duration = 300 - urgeSeconds
  state.urges.unshift({ date: formatDate(new Date()), durationSec: duration })
  saveAll(); renderUrges(); resetUrge(); $('#lastUrgeInfo').textContent = `${duration} sn`;
})

function renderUrges(){
  const list = $('#urgeHistory'); list.innerHTML = ''
  state.urges.slice(0,30).forEach(u => {
    const li = document.createElement('li')
    li.innerHTML = `
      <div>
        <div><strong>${Math.round(u.durationSec)} sn</strong></div>
        <div class="meta">${u.date}</div>
      </div>
      <div class="meta"></div>`
    list.appendChild(li)
  })
  if (state.urges[0]) $('#lastUrgeInfo').textContent = `${Math.round(state.urges[0].durationSec)} sn · ${state.urges[0].date}`
}

// Dashboard
function updateTodayGoal(){ $('#todayGoalText').textContent = state.settings.dailyGoal || 'Ayarlar\'dan hedef belirleyin.' }

function updateDashboard(){
  updateTodayGoal()
  const quit = state.settings.quitDate
  $('#daysSinceQuit').textContent = quit ? daysBetween(quit, new Date()) : 0
  // Streak: ardışık günlerde en son 7 gün içinde boşluksuz checkin varsayımı
  const sorted = [...state.checkins].sort((a,b)=>b.date.localeCompare(a.date))
  let streak = 0; let cursor = formatYMD(new Date())
  for(const c of sorted){
    if (c.date === cursor && c.success !== false){ streak++; cursor = formatYMD(new Date(new Date(cursor).getTime() - 86400000)) }
    else if (c.date > cursor){ continue } else { break }
  }
  $('#streakDays').textContent = streak
}

function renderAll(){ renderCheckins(); renderTriggers(); renderUrges(); updateDashboard() }

// Init
loadSettingsUI(); renderAll(); updateTimer()