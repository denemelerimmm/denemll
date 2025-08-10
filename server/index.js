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

// Schemas
const RegisterSchema = z.object({ email: z.string().email(), password: z.string().min(6) })
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })
const ForgotSchema = z.object({ email: z.string().email() })
const ResetSchema = z.object({ token: z.string().min(10), password: z.string().min(6) })

// Routes
app.get('/health', (req,res)=> res.json({ ok:true }))

app.post('/api/auth/register', (req,res)=>{
  const parsed = RegisterSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' })
  const { email, password } = parsed.data
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (exists) return res.status(409).json({ error: 'email_exists' })
  const hash = bcrypt.hashSync(password, 10)
  const role = db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0 ? 'admin' : 'user'
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

// Admin metrics
app.get('/api/admin/metrics', authMiddleware, (req,res)=>{
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' })
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c
  const today = new Date().toISOString().slice(0,10)
  const todaySignups = db.prepare("SELECT COUNT(*) as c FROM users WHERE substr(created_at,1,10)=?").get(today).c
  // Online not tracked here in DB; set to 0 for now or could implement
  const online = 0
  // Revenue not implemented in DB; return 0 to avoid breaking UI
  const revenue = 0
  res.json({ users, todaySignups, online, revenue })
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