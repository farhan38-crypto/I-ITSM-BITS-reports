// Start the assistant early. Gemini takes a second or two, so instead of waiting for the click on
// "Fill in the rest for me", the request starts once the student pauses typing; the click then
// picks up the answer that is already on its way (or done). The backend also caches answers by
// description for 15 minutes, so the same text never waits twice.
import { useEffect, useRef } from 'react'
import { api, type GeneratedIncident } from '../../api'

const pending = new Map<string, Promise<GeneratedIncident>>()
const key = (text: string) => text.trim().replace(/\s+/g, ' ')

/** The assistant's suggestions for this description: shared by the early start and the click. */
export function generateFor(text: string): Promise<GeneratedIncident> {
  const k = key(text)
  let p = pending.get(k)
  if (!p) {
    p = api.intelligence.generate(k)
    p.catch(() => pending.delete(k))          // a failure is retried on the click, not remembered
    pending.set(k, p)
    if (pending.size > 8) pending.delete(pending.keys().next().value as string)
  }
  return p
}

const IDLE_MS = 1200, MIN_CHARS = 25, MAX_EARLY = 3   // at most 3 early calls per report (API quota)

/** Starts the request after a pause in typing, while `enabled` (the assistant hasn't run yet). */
export function useEarlyAssist(text: string, enabled: boolean) {
  const used = useRef(0)
  useEffect(() => {
    const k = key(text)
    if (!enabled || k.length < MIN_CHARS || pending.has(k) || used.current >= MAX_EARLY) return
    const t = window.setTimeout(() => { used.current++; generateFor(k).catch(() => {}) }, IDLE_MS)
    return () => window.clearTimeout(t)
  }, [text, enabled])
}
