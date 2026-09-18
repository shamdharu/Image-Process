import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireAuth } from '../middleware/auth.js'

export const aiRouter = Router()

const MODEL = 'gemini-2.5-flash'
const MAX_MESSAGE_LENGTH = 4000
const knowledgePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../knowledge/imaginary-workspace.md')
const knowledgeDocument = fs.readFileSync(knowledgePath, 'utf8')
const knowledgeChunks = knowledgeDocument
  .split(/(?=^## )/m)
  .map((text) => text.trim())
  .filter(Boolean)

function terms(value) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((term) => term.length > 2))
}

function retrieveKnowledge(query, limit = 4) {
  const queryTerms = terms(query)
  return knowledgeChunks
    .map((chunk) => {
      const chunkTerms = terms(chunk)
      let score = 0
      queryTerms.forEach((term) => { if (chunkTerms.has(term)) score += 1 })
      if (chunk.toLowerCase().includes(query.toLowerCase())) score += 4
      return { chunk, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((item, index) => item.score > 0 || index === 0)
    .map((item) => item.chunk)
}

aiRouter.post('/api/ai/chat', requireAuth, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  const history = Array.isArray(req.body?.history) ? req.body.history : []

  if (!apiKey) return res.status(503).json({ error: 'Gemini is not configured. Add GEMINI_API_KEY to the server environment.' })
  if (!message) return res.status(400).json({ error: 'A message is required.' })
  if (message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.` })

  const contents = history
    .filter((item) => item && (item.role === 'user' || item.role === 'model') && typeof item.text === 'string')
    .slice(-12)
    .map((item) => ({ role: item.role, parts: [{ text: item.text.slice(0, MAX_MESSAGE_LENGTH) }] }))
  contents.push({ role: 'user', parts: [{ text: message }] })
  const retrievedContext = retrieveKnowledge(message).join('\n\n')

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `You are Imaginary Assistant, a concise and practical assistant inside an image workspace. Help with image organization, metadata, folder planning, search ideas, and creative production workflows. Do not claim to have performed actions you cannot perform. Answer using the workspace knowledge below when relevant. If the answer is not in the knowledge, say that it is not documented instead of inventing a product fact.\n\nWORKSPACE KNOWLEDGE:\n${retrievedContext}` }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 700 },
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) return res.status(502).json({ error: body.error?.message || 'Gemini could not answer right now.' })
    const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
    if (!text) return res.status(502).json({ error: 'Gemini returned an empty response.' })
    res.json({ text, model: MODEL, sources: retrievedContext ? ['imaginary-workspace.md'] : [] })
  } catch (error) {
    res.status(502).json({ error: error.message || 'Could not reach Gemini.' })
  }
})
