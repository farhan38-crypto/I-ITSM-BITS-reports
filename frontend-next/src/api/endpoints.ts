// One function per backend route, grouped like backend/app/routers/*.
import { learnHostels } from '../lib/format'
import { request, fetchBlobUrl, API_BASE, ApiError, tokens } from './client'
import type * as T from './types'

const enc = encodeURIComponent

export const auth = {
  login: (email: string, password: string) => request<T.LoginResult>('/auth/login', { body: { email, password } }),
  loginSecondStep: (mfa_token: string, code: string) => request<T.Session>('/auth/login/2fa', { body: { mfa_token, code } }),
  register: (body: { name: string; email: string; password: string; phone?: string }) => request<T.Session>('/auth/register', { body }),
  google: (credential: string, nonce?: string) => request<T.Session>('/auth/google', { body: { credential, nonce } }),
  me: () => request<T.User>('/auth/me'),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  requestReset: (email: string) => request<{ message: string }>('/auth/password-reset/request', { body: { email } }),
  confirmReset: (email: string, code: string, password: string) =>
    request<{ message: string }>('/auth/password-reset/confirm', { body: { email, code, password } }),
  resetWithAuthenticator: (email: string, code: string, password: string) =>
    request<{ message: string }>('/auth/password-reset/authenticator', { body: { email, code, password } }),
}

export const account = {
  overview: () => request<T.AccountOverview>('/account'),
  updateProfile: (body: { name?: string; phone?: string }) => request<{ user: T.User }>('/account/profile', { method: 'PATCH', body }),
  changePassword: (body: { current_password?: string; new_password: string }) => request<T.Session>('/account/password', { body }),
  startTwoFactor: () => request<T.TwoFactorSetup>('/account/2fa/setup', { method: 'POST' }),
  enableTwoFactor: (code: string) => request<{ backup_codes: string[]; two_factor: T.TwoFactorState }>('/account/2fa/enable', { body: { code } }),
  disableTwoFactor: (code: string) => request<{ two_factor: T.TwoFactorState }>('/account/2fa/disable', { body: { code } }),
  newBackupCodes: (code: string) => request<{ backup_codes: string[]; two_factor: T.TwoFactorState }>('/account/2fa/backup-codes', { body: { code } }),
  updatePreferences: (body: T.EmailPrefsUpdate) => request<{ preferences: T.EmailPrefs }>('/account/preferences', { method: 'PATCH', body }),
  emails: () => request<{ smtp_configured: boolean; emails: T.SentEmail[] }>('/account/emails'),
  sendDigestNow: () => request<{ status: string; attachment: string }>('/account/digest/send-now', { method: 'POST' }),
  saveAppearance: (body: { theme: string; glass_theme?: string; glass_prefs?: T.GlassPrefs; gradient?: unknown; saved_gradients?: unknown[] }) => request<{ appearance: T.Appearance }>('/account/appearance', { method: 'PUT', body }),
  signOutOthers: () => request<T.Session>('/account/sessions/sign-out-others', { method: 'POST' }),
}

export const incidents = {
  list: (f: T.IncidentFilters = {}) => request<T.Incident[]>('/incidents', { query: f as Record<string, unknown> }),
  get: (id: string) => request<T.IncidentDetail>(`/incidents/${enc(id)}`),
  create: (body: T.IncidentCreate) => request<T.Incident>('/incidents', { body }),
  update: (id: string, body: T.IncidentUpdate) => request<T.Incident>(`/incidents/${enc(id)}`, { method: 'PATCH', body }),
  transition: (id: string, body: T.TransitionInput) => request<T.Incident>(`/incidents/${enc(id)}/transition`, { body }),
  assign: (id: string, technician_id: string) => request<T.Incident>(`/incidents/${enc(id)}/assign`, { body: { technician_id } }),
  autoAssign: (id: string) => request<T.Incident>(`/incidents/${enc(id)}/auto-assign`, { method: 'POST' }),
  addNote: (id: string, text: string, kind = 'investigation') => request<T.Incident>(`/incidents/${enc(id)}/notes`, { body: { text, kind } }),
}

export const field = {
  info: (id: string) => request<T.FieldInfo>(`/incidents/${enc(id)}/field`),
  enRoute: (id: string) => request<T.Incident>(`/incidents/${enc(id)}/field/en-route`, { method: 'POST' }),
  arrive: (id: string, geo: { latitude?: number; longitude?: number; accuracy_m?: number } = {}) =>
    request<T.Incident>(`/incidents/${enc(id)}/field/arrive`, { body: geo }),
}

export const attachments = {
  list: (id: string) => request<T.Attachment[]>(`/incidents/${enc(id)}/attachments`),
  add: (id: string, body: T.AttachmentInput) => request<T.Attachment>(`/incidents/${enc(id)}/attachments`, { body }),
  contentUrl: (attachmentId: string) => fetchBlobUrl(`/attachments/${enc(attachmentId)}/content`),
}

export const intelligence = {
  generate: (description: string) => request<T.GeneratedIncident>('/intelligence/generate-incident', { body: { description } }),
  scope: (title: string, description: string, use_ai: boolean) => request<T.ScopeAssessment>('/intelligence/scope', { body: { title, description, use_ai } }),
  suggest: (title: string, description: string, categories?: string[], services?: string[]) =>
    request<T.Suggestions>('/intelligence/suggest', { body: { title, description, categories, services } }),
  duplicates: (title: string, description: string, service_id?: string) =>
    request<T.IncidentRef[]>('/intelligence/duplicates', { body: { title, description, service_id } }),
  correlations: () => request<T.Correlation[]>('/intelligence/correlations'),
}

export const catalog = {
  services: () => request<T.Service[]>('/catalog/services'),
  categories: () => request<T.Category[]>('/catalog/categories'),
  technicians: () => request<T.Technician[]>('/catalog/technicians'),
}

export const reports = {
  overview: () => request<T.Overview>('/reports/overview'),
  trends: (days = 14) => request<T.Trends>('/reports/trends', { query: { days } }),
  /** Role-scoped report for the last 1h / 6h / 1d / 7d / 30d (admin: all, technician: own + queue, student: own). */
  summary: (range: T.ReportRange) => request<T.ReportSummary>('/reports/summary', { query: { range } }),
  /** The same report as a file; returns an object URL to download. */
  exportUrl: (range: T.ReportRange, format: T.ExportFormat) => fetchBlobUrl('/reports/export', { range, format }),
  /** Email the report as an attachment to up to 10 addresses. */
  email: (body: { range: T.ReportRange; format: T.ExportFormat; recipients: string[]; message?: string; send_copy?: boolean }) =>
    request<T.ReportEmailResult>('/reports/email', { body }),
}

export const campus = {
  buildings: () => request<{ centre: T.Geo; buildings: T.Building[] }>('/campus/buildings').then(r => { learnHostels(r.buildings); return r }),
  setPin: (name: string, latitude: number, longitude: number) =>
    request<{ centre: T.Geo; buildings: T.Building[]; moved_incidents?: number }>(`/campus/buildings/${enc(name)}`, { method: 'PUT', body: { latitude, longitude } }),
  map: (days = 30, include_closed = false, hours?: number) =>
    request<T.CampusMapData>('/campus/map', { query: hours ? { days, include_closed, hours } : { days, include_closed } }),
}

export const assets = {
  list: () => request<T.Asset[]>('/assets'),
  get: (code: string) => request<T.Asset>(`/assets/${enc(code)}`),
  create: (body: T.AssetInput) => request<T.Asset>('/assets', { body }),
  update: (code: string, body: T.AssetInput) => request<T.Asset>(`/assets/${enc(code)}`, { method: 'PUT', body }),
  remove: (code: string) => request<null>(`/assets/${enc(code)}`, { method: 'DELETE' }),
  qrUrl: (code: string, base: string) => fetchBlobUrl(`/assets/${enc(code)}/qr.svg`, { base }),
}

export const admin = {
  users: () => request<T.User[]>('/admin/users'),
  createUser: (body: T.NewUser) => request<T.User>('/admin/users', { body }),
  updateUser: (id: string, body: { name?: string; phone?: string; skills?: string[]; max_concurrent?: number }) =>
    request<T.User>(`/admin/users/${enc(id)}`, { method: 'PATCH', body }),
  setActive: (id: string, is_active: boolean) => request<{ ok: true }>(`/admin/users/${enc(id)}/active`, { method: 'PATCH', body: { is_active } }),
  resetTwoFactor: (id: string) => request<{ ok: true }>(`/admin/users/${enc(id)}/reset-2fa`, { method: 'POST' }),

  services: () => request<T.Service[]>('/admin/services'),
  addService: (body: { name: string; description?: string; criticality: number }) => request<T.Service>('/admin/services', { body }),
  editService: (id: string, body: { name: string; description?: string; criticality: number }) => request<T.Service>(`/admin/services/${enc(id)}`, { method: 'PUT', body }),
  deleteService: (id: string) => request<{ ok: true }>(`/admin/services/${enc(id)}`, { method: 'DELETE' }),

  categories: () => request<T.Category[]>('/admin/categories'),
  addCategory: (name: string) => request<T.Category>('/admin/categories', { body: { name } }),
  deleteCategory: (id: string) => request<{ ok: true }>(`/admin/categories/${enc(id)}`, { method: 'DELETE' }),

  sla: () => request<T.SlaPolicy[]>('/admin/sla'),
  addSla: (body: Omit<T.SlaPolicy, 'id' | 'service_name'>) => request<T.SlaPolicy>('/admin/sla', { body }),
  editSla: (id: string, body: Omit<T.SlaPolicy, 'id' | 'service_name'>) => request<T.SlaPolicy>(`/admin/sla/${enc(id)}`, { method: 'PUT', body }),
  deleteSla: (id: string) => request<{ ok: true }>(`/admin/sla/${enc(id)}`, { method: 'DELETE' }),

  settings: () => request<T.SettingsBundle>('/admin/settings'),
  saveSettings: (body: Partial<T.Settings>) => request<T.SettingsBundle>('/admin/settings', { method: 'PUT', body }),

  audit: (f: { incident?: string; action?: string; actor?: string; date_from?: string; date_to?: string; limit?: number } = {}) =>
    request<T.AuditEntry[]>('/admin/audit', { query: f }),
  violations: (limit = 100) => request<T.SlaViolation[]>('/admin/sla-violations', { query: { limit } }),
}

export const notifications = {
  list: () => request<{ items: T.Notification[]; unread: number }>('/notifications'),
  read: (id: string) => request<{ ok: true }>(`/notifications/${enc(id)}/read`, { method: 'POST' }),
  readAll: () => request<{ ok: true }>('/notifications/read-all', { method: 'POST' }),
}

export const docs = { get: () => request<T.DocsPayload>('/docs') }

export const clientErrors = {
  report: (body: { kind: string; message: string; stack?: string; component_stack?: string; url?: string; reference?: string }) =>
    request<null>('/client-errors', { body }).catch(() => null),
}

/** Live wallpapers: everyone can list them; only administrators upload, edit and delete. */
export const wallpapers = {
  list: () => request<T.Wallpaper[]>('/wallpapers'),
  update: (id: string, body: { name?: string; start?: number; end?: number; duration?: number; a?: string; b?: string; poster?: string }) =>
    request<T.Wallpaper>(`/admin/wallpapers/${enc(id)}`, { method: 'PATCH', body }),
  remove: (id: string) => request<{ ok: true }>(`/admin/wallpapers/${enc(id)}`, { method: 'DELETE' }),
  /** The request body is the video file itself, sent with progress (fetch cannot report upload progress). */
  upload: (file: File, name: string, onProgress: (fraction: number) => void) => new Promise<T.Wallpaper>((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', `${API_BASE}/admin/wallpapers?name=${encodeURIComponent(name)}`)
    const token = tokens.get()
    if (token) x.setRequestHeader('Authorization', `Bearer ${token}`)
    x.setRequestHeader('Content-Type', file.type || 'video/mp4')
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    x.onload = () => {
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(x.responseText || '{}') } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300) resolve(body as unknown as T.Wallpaper)
      else reject(new ApiError(x.status, typeof body.detail === 'string' ? body.detail : `Upload failed (${x.status})`, body))
    }
    x.onerror = () => reject(new ApiError(0, 'Cannot reach the server. Check that the backend is running.'))
    x.send(file)
  }),
}
