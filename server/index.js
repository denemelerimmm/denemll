import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import Database from 'better-sqlite3'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'

const PORT = process.env.PORT || 8787
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change'
const RESET_TOKEN_TTL_MIN = 60
const DB_PATH = process.env.DB_PATH || path.resolve('/workspace/server/data.sqlite')

const app = express()
app.use(cors({ origin: '*', credentials: false }))
app.use(express.json())

// DB setup
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`)

// Data tables
db.exec(`
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY,
  quit_date TEXT,
  daily_goal TEXT,
  motivations TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS user_notes (
  user_id INTEGER PRIMARY KEY,
  quick TEXT,
  sos TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  success INTEGER,
  mood TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, date),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  intensity INTEGER NOT NULL,
  note TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS urges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`)

// Mailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}, { from: process.env.MAIL_FROM || 'no-reply@example.com' })

async function sendResetEmail(to, link){
  if (!process.env.SMTP_HOST) {
    const log = `[${new Date().toISOString()}] RESET ${to} -> ${link}\n`
    fs.appendFileSync('/workspace/server/reset.log', log)
    console.log('Reset link (dev):', link)
    return
  }
  await transporter.sendMail({ to, subject: 'Şifre Sıfırlama', text: `Şifrenizi sıfırlamak için bağlantı: ${link}`, html: `<p>Şifrenizi sıfırlamak için bağlantı:</p><p><a href="${link}">${link}</a></p>` })
}

function createToken(payload){ return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' }) }
function authMiddleware(req,res,next){
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ')? h.slice(7): ''
  if (!token) return res.status(401).json({ error: 'unauthorized' })
  try { req.user = jwt.verify(token, JWT_SECRET); next() } catch { return res.status(401).json({ error: 'invalid_token' }) }
}

function requireUser(req){
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!u) throw new Error('no_user')
  return u
}

// Schemas
const RegisterSchema = z.object({ email: z.string().email(), password: z.string().min(6) })
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })
const ForgotSchema = z.object({ email: z.string().email() })
const ResetSchema = z.object({ token: z.string().min(10), password: z.string().min(6) })

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)
function isAdminEmail(email){ return ADMIN_EMAILS.includes(String(email||'').toLowerCase()) }

// Routes
app.get('/health', (req,res)=> res.json({ ok:true }))

app.post('/api/auth/register', (req,res)=>{
  const parsed = RegisterSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
  const { email, password } = parsed.data
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (exists) return res.status(409).json({ error: 'email_exists' })
  const hash = bcrypt.hashSync(password, 10)
  const role = isAdminEmail(email) ? 'admin' : 'user'
  const info = db.prepare('INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run(email, hash, role, new Date().toISOString())
  const token = createToken({ id: info.lastInsertRowid, email, role })
  res.json({ token, user: { id: info.lastInsertRowid, email, role } })
})

app.post('/api/auth/login', (req,res)=>{
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
  const { email, password } = parsed.data
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.status(401).json({ error: 'invalid_credentials' })
  const ok = bcrypt.compareSync(password, user.password_hash)
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' })
  const shouldRole = isAdminEmail(email) ? 'admin' : 'user'
  if (user.role !== shouldRole) { db.prepare('UPDATE users SET role = ? WHERE id = ?').run(shouldRole, user.id); user.role = shouldRole }
  const token = createToken({ id: user.id, email: user.email, role: user.role })
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } })
})

app.post('/api/auth/forgot', async (req,res)=>{
  const parsed = ForgotSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
  const { email } = parsed.data
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.json({ ok:true })
  const token = cryptoRandom(48)
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MIN*60*1000).toISOString()
  db.prepare('INSERT INTO password_resets (user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?)').run(user.id, token, expires, new Date().toISOString())
  const link = (process.env.APP_BASE_URL || 'http://localhost:8000') + `/?resetToken=${token}`
  await sendResetEmail(email, link)
  res.json({ ok:true })
})

app.post('/api/auth/reset', (req,res)=>{
  const parsed = ResetSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
  const { token, password } = parsed.data
  const row = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token)
  if (!row) return res.status(400).json({ error: 'invalid_token' })
  if (new Date(row.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'expired' })
  const hash = bcrypt.hashSync(password, 10)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.user_id)
  db.prepare('DELETE FROM password_resets WHERE id = ?').run(row.id)
  res.json({ ok:true })
})

// Settings
app.get('/api/settings', authMiddleware, (req,res)=>{
  const row = db.prepare('SELECT quit_date, daily_goal, motivations FROM user_settings WHERE user_id = ?').get(req.user.id)
  res.json({ settings: row || { quit_date:null, daily_goal:null, motivations:null } })
})
app.post('/api/settings', authMiddleware, (req,res)=>{
  const body = req.body||{}
  db.prepare('INSERT INTO user_settings (user_id, quit_date, daily_goal, motivations) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET quit_date=excluded.quit_date,daily_goal=excluded.daily_goal,motivations=excluded.motivations').run(req.user.id, body.quitDate||null, body.dailyGoal||null, body.motivations||null)
  res.json({ ok:true })
})

// Notes
app.get('/api/notes', authMiddleware, (req,res)=>{
  const row = db.prepare('SELECT quick, sos FROM user_notes WHERE user_id = ?').get(req.user.id)
  res.json({ notes: row || { quick:'', sos:'' } })
})
app.post('/api/notes', authMiddleware, (req,res)=>{
  const body = req.body||{}
  db.prepare('INSERT INTO user_notes (user_id, quick, sos) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET quick=excluded.quick,sos=excluded.sos').run(req.user.id, body.quick||'', body.sos||'')
  res.json({ ok:true })
})

// Checkins
app.get('/api/checkins', authMiddleware, (req,res)=>{
  const limit = Math.min(365, Number(req.query.limit||90))
  const rows = db.prepare('SELECT date, success, mood, note FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT ?').all(req.user.id, limit)
  res.json({ checkins: rows })
})
app.post('/api/checkins', authMiddleware, (req,res)=>{
  const b = req.body||{}
  const date = b.date || new Date().toISOString().slice(0,10)
  const success = (b.success===true?1:(b.success===false?0:null))
  const mood = b.mood||null
  const note = b.note||null
  db.prepare('INSERT INTO checkins (user_id, date, success, mood, note, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id,date) DO UPDATE SET success=coalesce(excluded.success, checkins.success), mood=coalesce(excluded.mood, checkins.mood), note=coalesce(excluded.note, checkins.note)').run(req.user.id, date, success, mood, note, new Date().toISOString())
  res.json({ ok:true })
})

// Triggers
app.get('/api/triggers', authMiddleware, (req,res)=>{
  const limit = Math.min(200, Number(req.query.limit||100))
  const rows = db.prepare('SELECT at, type, intensity, note FROM triggers WHERE user_id = ? ORDER BY at DESC LIMIT ?').all(req.user.id, limit)
  res.json({ triggers: rows })
})
app.post('/api/triggers', authMiddleware, (req,res)=>{
  const b = req.body||{}
  const at = b.at || new Date().toISOString()
  const type = b.type||'Diğer'
  const intensity = Number(b.intensity||0)
  const note = b.note||null
  db.prepare('INSERT INTO triggers (user_id, at, type, intensity, note) VALUES (?, ?, ?, ?, ?)').run(req.user.id, at, type, intensity, note)
  res.json({ ok:true })
})

// Urges
app.get('/api/urges', authMiddleware, (req,res)=>{
  const limit = Math.min(200, Number(req.query.limit||100))
  const rows = db.prepare('SELECT at, duration_sec FROM urges WHERE user_id = ? ORDER BY at DESC LIMIT ?').all(req.user.id, limit)
  res.json({ urges: rows })
})
app.post('/api/urges', authMiddleware, (req,res)=>{
  const b = req.body||{}
  const at = b.at || new Date().toISOString()
  const duration = Math.max(0, Number(b.durationSec||0))
  db.prepare('INSERT INTO urges (user_id, at, duration_sec) VALUES (?, ?, ?)').run(req.user.id, at, duration)
  res.json({ ok:true })
})

// Bundle data
app.get('/api/data', authMiddleware, (req,res)=>{
  const settings = db.prepare('SELECT quit_date, daily_goal, motivations FROM user_settings WHERE user_id = ?').get(req.user.id) || { quit_date:null, daily_goal:null, motivations:null }
  const notes = db.prepare('SELECT quick, sos FROM user_notes WHERE user_id = ?').get(req.user.id) || { quick:'', sos:'' }
  const checkins = db.prepare('SELECT date, success, mood, note FROM checkins WHERE user_id = ? ORDER BY date DESC LIMIT 180').all(req.user.id)
  const triggers = db.prepare('SELECT at, type, intensity, note FROM triggers WHERE user_id = ? ORDER BY at DESC LIMIT 200').all(req.user.id)
  const urges = db.prepare('SELECT at, duration_sec FROM urges WHERE user_id = ? ORDER BY at DESC LIMIT 200').all(req.user.id)
  res.json({ settings, notes, checkins, triggers, urges })
})

// Migrate
app.post('/api/migrate', authMiddleware, (req,res)=>{
  const b = req.body||{}
  if (b.settings) db.prepare('INSERT INTO user_settings (user_id, quit_date, daily_goal, motivations) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET quit_date=excluded.quit_date,daily_goal=excluded.daily_goal,motivations=excluded.motivations').run(req.user.id, b.settings.quitDate||null, b.settings.dailyGoal||null, b.settings.motivations||null)
  if (b.notes) db.prepare('INSERT INTO user_notes (user_id, quick, sos) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET quick=excluded.quick,sos=excluded.sos').run(req.user.id, b.notes.quick||'', b.notes.sos||'')
  if (Array.isArray(b.checkins)){
    const stmt = db.prepare('INSERT INTO checkins (user_id, date, success, mood, note, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id,date) DO UPDATE SET success=coalesce(excluded.success, checkins.success), mood=coalesce(excluded.mood, checkins.mood), note=coalesce(excluded.note, checkins.note)')
    const now = new Date().toISOString()
    db.transaction((rows)=>{ for(const c of rows){ stmt.run(req.user.id, c.date, (c.success===true?1:(c.success===false?0:null)), c.mood||null, c.note||null, now) } })(b.checkins)
  }
  if (Array.isArray(b.triggers)){
    const stmt = db.prepare('INSERT INTO triggers (user_id, at, type, intensity, note) VALUES (?, ?, ?, ?, ?)')
    db.transaction((rows)=>{ for(const t of rows){ stmt.run(req.user.id, t.date||t.at||new Date().toISOString(), t.type||'Diğer', Number(t.intensity||0), t.note||null) } })(b.triggers)
  }
  if (Array.isArray(b.urges)){
    const stmt = db.prepare('INSERT INTO urges (user_id, at, duration_sec) VALUES (?, ?, ?)')
    db.transaction((rows)=>{ for(const u of rows){ stmt.run(req.user.id, u.date||u.at||new Date().toISOString(), Number(u.durationSec||u.duration_sec||0)) } })(b.urges)
  }
  res.json({ ok:true })
})

// Stats
app.get('/api/stats', authMiddleware, (req,res)=>{
  const today = new Date(); const dates=[]; for(let i=6;i>=0;i--){ const d=new Date(today); d.setDate(today.getDate()-i); dates.push(d.toISOString().slice(0,10)) }
  const map = Object.fromEntries(dates.map(d=>[d,null]))
  db.prepare('SELECT date, success FROM checkins WHERE user_id = ? AND date >= ?').all(req.user.id, dates[0]).forEach(r=>{ map[r.date] = r.success })
  const checkins7 = dates.map(d=> map[d])
  const urges = db.prepare('SELECT duration_sec FROM urges WHERE user_id = ? ORDER BY at DESC LIMIT 7').all(req.user.id).map(r=>r.duration_sec)
  const total = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(req.user.id).c
  const success = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ? AND success = 1').get(req.user.id).c
  res.json({ checkins7, urges: urges.reverse(), success, total })
})

// Stories (global)
app.get('/api/stories', (req,res)=>{
  // For now, stories are not in DB; kept minimal. Could be migrated later.
  const raw = fs.existsSync('/workspace/server/stories.json') ? JSON.parse(fs.readFileSync('/workspace/server/stories.json','utf8')) : []
  res.json({ stories: raw })
})
app.post('/api/stories', authMiddleware, (req,res)=>{
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  const body = req.body || {}
  const type = body.type === 'text' ? 'text' : 'video'
  const title = String(body.title||'').slice(0,200)
  const url = String(body.url||'')
  const content = String(body.content||'')
  const list = fs.existsSync('/workspace/server/stories.json') ? JSON.parse(fs.readFileSync('/workspace/server/stories.json','utf8')) : []
  const id = cryptoRandom(16)
  list.unshift({ id, type, title, url, content, addedAt: new Date().toISOString(), by: req.user.email })
  fs.writeFileSync('/workspace/server/stories.json', JSON.stringify(list, null, 2))
  res.json({ ok:true, id })
})
app.delete('/api/stories/:id', authMiddleware, (req,res)=>{
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  const id = req.params.id
  const list = fs.existsSync('/workspace/server/stories.json') ? JSON.parse(fs.readFileSync('/workspace/server/stories.json','utf8')) : []
  const next = list.filter(s=>s.id!==id)
  fs.writeFileSync('/workspace/server/stories.json', JSON.stringify(next, null, 2))
  res.json({ ok:true })
})

function cryptoRandom(len){
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  while (s.length < len) { s += chars[Math.floor(Math.random()*chars.length)] }
  return s
}

app.listen(PORT, ()=>{
  console.log(`API listening on http://0.0.0.0:${PORT}`)
})