import React, { useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Badge, Button, ScrollArea, Separator, StatusDot } from '@hermes/plugin-sdk'

const PLUGIN_ID = 'agent-mission-control'
const STORAGE_KEY = 'recent-events'
const MAX_EVENTS = 200
const FEED_EVENTS = 80
const PROFILE_POLL_MS = 3000
const FILTER_LIMIT = 6

let runtimeSingleton = null

function isoNow() {
  return new Date().toISOString()
}

function safeString(value, fallback = 'unknown') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function maybeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function truncate(text, max = 140) {
  const value = typeof text === 'string' ? text : ''
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function formatTime(ts) {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatCount(value) {
  return new Intl.NumberFormat().format(value || 0)
}

function formatDurationMs(value) {
  if (!value || value < 0) return '—'
  if (value < 1000) return `${value}ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
  return `${(value / 60_000).toFixed(1)}m`
}

function extractRawType(rawEvent) {
  return safeString(
    rawEvent?.type || rawEvent?.event || rawEvent?.name || rawEvent?.kind || rawEvent?.topic,
    'desktop.event'
  )
}

function collectStrings(value, bucket = []) {
  if (typeof value === 'string') {
    bucket.push(value)
    return bucket
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, bucket))
    return bucket
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStrings(item, bucket))
  }
  return bucket
}

function getTextCorpus(rawEvent) {
  return collectStrings(rawEvent).join(' ').toLowerCase()
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

function classifyStatus(rawEvent, text) {
  const explicit = safeString(
    rawEvent?.status || rawEvent?.state || rawEvent?.phase || rawEvent?.result || rawEvent?.outcome,
    ''
  ).toLowerCase()

  if (explicit.includes('fail') || explicit.includes('error') || explicit.includes('cancel')) return 'failed'
  if (explicit.includes('block')) return 'blocked'
  if (explicit.includes('complete') || explicit.includes('success') || explicit.includes('done') || explicit.includes('finish')) return 'completed'
  if (explicit.includes('queue') || explicit.includes('pending') || explicit.includes('wait')) return 'queued'
  if (explicit.includes('run') || explicit.includes('start') || explicit.includes('active') || explicit.includes('progress')) return 'running'
  if (explicit.includes('idle')) return 'idle'

  if (text.includes('failed') || text.includes('error') || text.includes('exception') || text.includes('traceback')) return 'failed'
  if (text.includes('blocked')) return 'blocked'
  if (text.includes('completed') || text.includes('finished') || text.includes('succeeded')) return 'completed'
  if (text.includes('queued') || text.includes('pending')) return 'queued'
  if (text.includes('running') || text.includes('started') || text.includes('active')) return 'running'

  return 'observed'
}

function classifyEventType(rawType, text) {
  const joined = `${rawType} ${text}`.toLowerCase()

  if (joined.includes('profile') && (joined.includes('switch') || joined.includes('active') || joined.includes('focus'))) return 'profile.activity'
  if (joined.includes('profile') && joined.includes('idle')) return 'profile.idle'
  if (joined.includes('handoff') || joined.includes('route') || joined.includes('forward')) return 'handoff.created'
  if (joined.includes('delegate') && (joined.includes('fail') || joined.includes('error'))) return 'delegate.failed'
  if (joined.includes('delegate') && (joined.includes('complete') || joined.includes('done') || joined.includes('finish'))) return 'delegate.completed'
  if (joined.includes('delegate')) return 'delegate.started'
  if (joined.includes('cron') && (joined.includes('fail') || joined.includes('error'))) return 'cron.failed'
  if (joined.includes('cron') && (joined.includes('complete') || joined.includes('done') || joined.includes('finish'))) return 'cron.completed'
  if (joined.includes('cron')) return 'cron.started'
  if (joined.includes('kanban') && (joined.includes('complete') || joined.includes('done'))) return 'kanban.completed'
  if (joined.includes('kanban') && (joined.includes('claim') || joined.includes('assign'))) return 'kanban.claimed'
  if (joined.includes('process') && (joined.includes('complete') || joined.includes('exit') || joined.includes('finish'))) return 'process.completed'
  if (joined.includes('process') && (joined.includes('start') || joined.includes('spawn') || joined.includes('run'))) return 'process.started'
  if (joined.includes('token') || joined.includes('cost') || joined.includes('usage')) return 'usage.observed'
  if (joined.includes('error') || joined.includes('exception') || joined.includes('traceback')) return 'error.observed'

  return rawType || 'desktop.event'
}

function inferProfilePair(rawEvent, fallbackProfile) {
  const source = firstDefined(
    rawEvent?.source_profile,
    rawEvent?.sourceProfile,
    rawEvent?.from_profile,
    rawEvent?.fromProfile,
    rawEvent?.profile,
    rawEvent?.profile_name,
    rawEvent?.profileName,
    fallbackProfile
  )

  const target = firstDefined(
    rawEvent?.target_profile,
    rawEvent?.targetProfile,
    rawEvent?.to_profile,
    rawEvent?.toProfile,
    rawEvent?.assignee_profile,
    rawEvent?.assigneeProfile,
    rawEvent?.worker_profile,
    rawEvent?.workerProfile,
    rawEvent?.delegate_profile,
    rawEvent?.delegateProfile
  )

  return {
    source_profile: source ? safeString(source, fallbackProfile) : fallbackProfile,
    target_profile: target ? safeString(target, 'unknown') : null
  }
}

function normalizeEvent(rawEvent, fallbackProfile, sequence) {
  const rawType = extractRawType(rawEvent)
  const text = getTextCorpus(rawEvent)
  const profiles = inferProfilePair(rawEvent, fallbackProfile)
  const status = classifyStatus(rawEvent, text)
  const eventType = classifyEventType(rawType, text)

  return {
    event_id: `evt-${Date.now()}-${sequence}`,
    ts: safeString(firstDefined(rawEvent?.ts, rawEvent?.timestamp, rawEvent?.created_at, rawEvent?.time), isoNow()),
    event_type: eventType,
    source_profile: profiles.source_profile,
    target_profile: profiles.target_profile,
    session_id: firstDefined(rawEvent?.session_id, rawEvent?.sessionId, rawEvent?.session),
    run_id: firstDefined(rawEvent?.run_id, rawEvent?.runId, rawEvent?.delegation_id, rawEvent?.process_id, rawEvent?.job_id),
    task_id: firstDefined(rawEvent?.task_id, rawEvent?.taskId, rawEvent?.issue_id, rawEvent?.kanban_task_id),
    status,
    model: firstDefined(rawEvent?.model, rawEvent?.model_name, rawEvent?.modelName),
    provider: firstDefined(rawEvent?.provider, rawEvent?.provider_name, rawEvent?.providerName),
    tokens_in: maybeNumber(firstDefined(rawEvent?.tokens_in, rawEvent?.prompt_tokens, rawEvent?.input_tokens)),
    tokens_out: maybeNumber(firstDefined(rawEvent?.tokens_out, rawEvent?.completion_tokens, rawEvent?.output_tokens)),
    estimated_cost_usd: maybeNumber(firstDefined(rawEvent?.estimated_cost_usd, rawEvent?.cost_usd, rawEvent?.cost)),
    duration_ms: maybeNumber(firstDefined(rawEvent?.duration_ms, rawEvent?.elapsed_ms, rawEvent?.latency_ms)),
    metadata: {
      raw_event_type: rawType,
      summary: truncate(firstDefined(rawEvent?.title, rawEvent?.message, rawEvent?.summary, rawEvent?.description), 180),
      raw: rawEvent || {}
    }
  }
}

function buildSyntheticProfileEvent(profileName, previousProfile, sequence) {
  return {
    event_id: `evt-profile-${Date.now()}-${sequence}`,
    ts: isoNow(),
    event_type: 'profile.activity',
    source_profile: profileName,
    target_profile: null,
    session_id: null,
    run_id: null,
    task_id: null,
    status: 'active',
    model: null,
    provider: null,
    tokens_in: null,
    tokens_out: null,
    estimated_cost_usd: null,
    duration_ms: null,
    metadata: {
      raw_event_type: 'synthetic.profile.poll',
      previous_profile: previousProfile || null,
      summary: previousProfile ? `Profile switched from ${previousProfile} to ${profileName}` : `Observed active profile ${profileName}`,
      raw: {
        previous_profile: previousProfile || null,
        profile: profileName
      }
    }
  }
}

function createEmptySnapshot() {
  return {
    captureState: 'booting',
    currentProfile: 'unknown',
    events: [],
    adapters: {
      desktopEventAdapter: 'booting',
      profileStateAdapter: 'booting',
      delegationAdapter: 'heuristic',
      cronAdapter: 'heuristic',
      kanbanAdapter: 'heuristic',
      processAdapter: 'heuristic',
      costAdapter: 'heuristic'
    },
    stats: {
      capturedEvents: 0,
      handoffEvents: 0,
      activeProfilesSeen: 0,
      lastEventTs: 'none yet'
    },
    diagnostics: {
      lastError: null,
      hydratedFromStorage: false,
      persistence: 'unknown'
    }
  }
}

function createRuntime(ctx) {
  const { host, storage } = ctx
  const listeners = new Set()
  const snapshot = createEmptySnapshot()
  let disposeHost = null
  let profileInterval = null
  let sequence = 0
  let started = false
  let lastObservedProfile = safeString(host.state.profile?.get?.(), 'default')

  function emit() {
    listeners.forEach(listener => listener({ ...snapshot }))
  }

  function recalcStats() {
    snapshot.stats.capturedEvents = snapshot.events.length
    snapshot.stats.handoffEvents = snapshot.events.filter(item => item.event_type.startsWith('handoff') || item.target_profile).length
    snapshot.stats.activeProfilesSeen = new Set(snapshot.events.map(item => item.source_profile).filter(Boolean)).size
    snapshot.stats.lastEventTs = snapshot.events[0] ? snapshot.events[0].ts : 'none yet'
  }

  function persistEvents() {
    if (!storage || typeof storage.set !== 'function') {
      snapshot.diagnostics.persistence = 'unavailable'
      emit()
      return
    }

    snapshot.diagnostics.persistence = 'saving'
    Promise.resolve(storage.set(STORAGE_KEY, snapshot.events))
      .then(() => {
        snapshot.diagnostics.persistence = 'ready'
        emit()
      })
      .catch(error => {
        snapshot.diagnostics.persistence = 'error'
        snapshot.diagnostics.lastError = `storage.set failed: ${String(error)}`
        emit()
      })
  }

  function pushEvent(event) {
    snapshot.events = [event, ...snapshot.events].slice(0, MAX_EVENTS)
    snapshot.currentProfile = safeString(event.source_profile, snapshot.currentProfile)
    recalcStats()
    emit()
    persistEvents()
  }

  function recordError(message) {
    snapshot.captureState = 'degraded'
    snapshot.adapters.desktopEventAdapter = 'degraded'
    snapshot.diagnostics.lastError = message
    emit()
  }

  function observeProfile(force = false) {
    const profileName = safeString(host.state.profile?.get?.(), 'default')
    snapshot.currentProfile = profileName
    snapshot.adapters.profileStateAdapter = 'active'

    if (force || profileName !== lastObservedProfile) {
      sequence += 1
      pushEvent(buildSyntheticProfileEvent(profileName, force ? null : lastObservedProfile, sequence))
      lastObservedProfile = profileName
      return
    }

    emit()
  }

  function start() {
    if (started) return
    started = true
    snapshot.captureState = 'hydrating'
    emit()

    if (storage && typeof storage.get === 'function') {
      Promise.resolve(storage.get(STORAGE_KEY))
        .then(value => {
          if (Array.isArray(value) && value.length) {
            snapshot.events = value.slice(0, MAX_EVENTS)
            snapshot.diagnostics.hydratedFromStorage = true
            recalcStats()
          }
          snapshot.diagnostics.persistence = 'ready'
          emit()
        })
        .catch(error => {
          snapshot.diagnostics.persistence = 'error'
          snapshot.diagnostics.lastError = `storage.get failed: ${String(error)}`
          emit()
        })
        .finally(() => {
          observeProfile(true)
        })
    } else {
      snapshot.diagnostics.persistence = 'unavailable'
      observeProfile(true)
    }

    try {
      disposeHost = host.onEvent('*', rawEvent => {
        sequence += 1
        snapshot.captureState = 'listening'
        snapshot.adapters.desktopEventAdapter = 'active'
        const profileName = safeString(host.state.profile?.get?.(), snapshot.currentProfile || 'default')
        pushEvent(normalizeEvent(rawEvent, profileName, sequence))
      })
    } catch (error) {
      recordError(`host.onEvent subscription failed: ${String(error)}`)
    }

    profileInterval = setInterval(() => observeProfile(false), PROFILE_POLL_MS)
  }

  function stop() {
    if (typeof disposeHost === 'function') disposeHost()
    if (profileInterval) clearInterval(profileInterval)
    disposeHost = null
    profileInterval = null
    started = false
  }

  return {
    start,
    stop,
    clear() {
      snapshot.events = []
      recalcStats()
      emit()
      persistEvents()
    },
    getSnapshot() {
      return { ...snapshot }
    },
    subscribe(listener) {
      listeners.add(listener)
      listener({ ...snapshot })
      return () => listeners.delete(listener)
    }
  }
}

function ensureRuntime(ctx) {
  if (!runtimeSingleton) runtimeSingleton = createRuntime(ctx)
  runtimeSingleton.start()
  return runtimeSingleton
}

function section(title, child, actions = null) {
  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '8px' },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
        children: [
          jsx('div', {
            style: {
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--ui-text-secondary)',
              letterSpacing: '0.02em',
              textTransform: 'uppercase'
            },
            children: title
          }),
          actions
        ]
      }),
      child
    ]
  })
}

function keyValue(label, value) {
  return jsxs('div', {
    style: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px' },
    children: [
      jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: label }),
      jsx('span', { style: { color: 'var(--ui-text-primary)', textAlign: 'right' }, children: value })
    ]
  })
}

function chipButton(label, active, onClick) {
  return jsx(Button, {
    onClick,
    children: label,
    style: {
      padding: '4px 8px',
      minHeight: '28px',
      borderRadius: '999px',
      opacity: active ? 1 : 0.82,
      border: active ? '1px solid var(--ui-accent)' : '1px solid var(--ui-stroke-secondary)'
    }
  })
}

function useRuntimeSnapshot(runtime) {
  const [snapshot, setSnapshot] = useState(runtime.getSnapshot())

  useEffect(() => runtime.subscribe(setSnapshot), [runtime])

  return snapshot
}

function summarizeProfiles(events) {
  const map = new Map()

  events.forEach(event => {
    const key = safeString(event.source_profile, 'unknown')
    const entry = map.get(key) || {
      profile: key,
      count: 0,
      lastTs: null,
      running: 0,
      failed: 0,
      completed: 0,
      handoffsOut: 0,
      handoffsIn: 0,
      models: new Set()
    }

    entry.count += 1
    entry.lastTs = entry.lastTs && entry.lastTs > event.ts ? entry.lastTs : event.ts
    if (event.status === 'running' || event.status === 'active') entry.running += 1
    if (event.status === 'failed') entry.failed += 1
    if (event.status === 'completed') entry.completed += 1
    if (event.target_profile) entry.handoffsOut += 1
    if (event.model) entry.models.add(event.model)
    map.set(key, entry)

    if (event.target_profile) {
      const targetKey = safeString(event.target_profile, 'unknown')
      const targetEntry = map.get(targetKey) || {
        profile: targetKey,
        count: 0,
        lastTs: null,
        running: 0,
        failed: 0,
        completed: 0,
        handoffsOut: 0,
        handoffsIn: 0,
        models: new Set()
      }
      targetEntry.handoffsIn += 1
      map.set(targetKey, targetEntry)
    }
  })

  return [...map.values()]
    .map(item => ({ ...item, models: [...item.models] }))
    .sort((a, b) => b.count - a.count)
}

function summarizeTypes(events) {
  const counts = new Map()
  events.forEach(event => counts.set(event.event_type, (counts.get(event.event_type) || 0) + 1))
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function summarizeStatuses(events) {
  const counts = new Map()
  events.forEach(event => counts.set(event.status, (counts.get(event.status) || 0) + 1))
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function deriveHandoffs(events) {
  return events.filter(event => event.target_profile || event.event_type.startsWith('handoff') || event.event_type.startsWith('delegate'))
}

function deriveHints(events, handoffs, profiles) {
  const hints = []
  const recentFailures = events.filter(event => event.status === 'failed').length
  const queuedOrBlocked = events.filter(event => event.status === 'queued' || event.status === 'blocked').length
  const activeProfiles = profiles.filter(item => item.running > 0 || item.count > 0).length

  if (!events.length) {
    hints.push({ tone: 'neutral', text: 'No events captured yet. Enable the plugin while routing work across profiles to build observability data.' })
    return hints
  }

  if (recentFailures >= 3) {
    hints.push({ tone: 'warn', text: `${recentFailures} failed events were observed in the current buffer. Inspect the raw event view to separate genuine failures from heuristic misclassification.` })
  }

  if (queuedOrBlocked >= 3) {
    hints.push({ tone: 'warn', text: `${queuedOrBlocked} queued/blocked events suggest a possible bottleneck or missing handoff acceptance in the current pipeline.` })
  }

  if (handoffs.length >= 5) {
    hints.push({ tone: 'info', text: `${handoffs.length} handoff-like events were seen. Use this to spot profiles that are acting mainly as routers versus execution owners.` })
  }

  if (activeProfiles >= 3) {
    hints.push({ tone: 'ok', text: `${activeProfiles} profiles are represented in the current buffer, which is enough to start comparing routing density and ownership patterns.` })
  }

  if (!hints.length) {
    hints.push({ tone: 'neutral', text: 'Capture is healthy, but the buffer is still too small for strong conclusions. Keep the pane running during real cross-profile work.' })
  }

  return hints.slice(0, 4)
}

function filterEvents(events, profileFilter, typeFilter, statusFilter) {
  return events.filter(event => {
    const profilePass = profileFilter === 'all' || event.source_profile === profileFilter || event.target_profile === profileFilter
    const typePass = typeFilter === 'all' || event.event_type === typeFilter
    const statusPass = statusFilter === 'all' || event.status === statusFilter
    return profilePass && typePass && statusPass
  })
}

function statCard(title, value, caption) {
  return jsxs('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '10px 12px',
      border: '1px solid var(--ui-stroke-secondary)',
      borderRadius: '10px',
      minWidth: 0
    },
    children: [
      jsx('div', { style: { fontSize: '11px', color: 'var(--ui-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.02em' }, children: title }),
      jsx('div', { style: { fontSize: '18px', fontWeight: 700, color: 'var(--ui-text-primary)' }, children: value }),
      jsx('div', { style: { fontSize: '11px', color: 'var(--ui-text-secondary)', lineHeight: 1.4 }, children: caption })
    ]
  })
}

function ProfileCard({ item, active }) {
  return jsxs('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '10px 12px',
      border: active ? '1px solid var(--ui-accent)' : '1px solid var(--ui-stroke-secondary)',
      borderRadius: '10px'
    },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
        children: [
          jsx('div', { style: { fontSize: '13px', fontWeight: 700 }, children: item.profile }),
          jsx(Badge, { children: item.running > 0 ? 'active-ish' : 'observed' })
        ]
      }),
      keyValue('Events', formatCount(item.count)),
      keyValue('Running/active', formatCount(item.running)),
      keyValue('Failures', formatCount(item.failed)),
      keyValue('Completed', formatCount(item.completed)),
      keyValue('Handoffs out/in', `${formatCount(item.handoffsOut)} / ${formatCount(item.handoffsIn)}`),
      keyValue('Last seen', item.lastTs ? formatTime(item.lastTs) : '—')
    ]
  })
}

function HandoffCard({ event }) {
  return jsxs('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      padding: '10px 12px',
      border: '1px solid var(--ui-stroke-secondary)',
      borderRadius: '10px'
    },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
        children: [
          jsx('div', { style: { fontSize: '13px', fontWeight: 700 }, children: `${event.source_profile || 'unknown'} → ${event.target_profile || 'unknown'}` }),
          jsx(Badge, { children: event.status })
        ]
      }),
      jsx('div', { style: { fontSize: '12px', color: 'var(--ui-text-secondary)' }, children: event.event_type }),
      jsx('div', { style: { fontSize: '12px', color: 'var(--ui-text-secondary)' }, children: event.metadata?.summary || 'No summary available' })
    ]
  })
}

function EventRow({ item, selected, onSelect }) {
  const target = item.target_profile ? ` → ${item.target_profile}` : ''
  const summary = item.metadata?.summary ? truncate(item.metadata.summary, 120) : ''

  return jsx('button', {
    onClick: () => onSelect(item),
    style: {
      width: '100%',
      textAlign: 'left',
      background: 'transparent',
      border: selected ? '1px solid var(--ui-accent)' : '1px solid var(--ui-stroke-secondary)',
      borderRadius: '10px',
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      cursor: 'pointer'
    },
    children: jsxs('div', {
      style: { display: 'flex', flexDirection: 'column', gap: '6px' },
      children: [
        jsxs('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
          children: [
            jsx('div', { style: { fontSize: '13px', color: 'var(--ui-text-primary)', fontWeight: 600 }, children: item.event_type }),
            jsx(Badge, { children: item.status })
          ]
        }),
        jsxs('div', {
          style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', color: 'var(--ui-text-secondary)' },
          children: [
            jsx('span', { children: `${item.source_profile || 'unknown-profile'}${target}` }),
            jsx('span', { children: formatTime(item.ts) })
          ]
        }),
        summary
          ? jsx('div', {
              style: { fontSize: '12px', color: 'var(--ui-text-secondary)', lineHeight: 1.4 },
              children: summary
            })
          : null
      ]
    })
  })
}

function HintRow({ hint }) {
  const color = hint.tone === 'warn'
    ? 'var(--ui-warning, var(--ui-text-primary))'
    : hint.tone === 'ok'
      ? 'var(--ui-success, var(--ui-text-primary))'
      : 'var(--ui-text-secondary)'

  return jsx('div', {
    style: {
      padding: '10px 12px',
      border: '1px solid var(--ui-stroke-secondary)',
      borderRadius: '10px',
      fontSize: '12px',
      color,
      lineHeight: 1.45
    },
    children: hint.text
  })
}

function RawInspector({ event }) {
  if (!event) {
    return jsx('div', {
      style: {
        padding: '12px',
        border: '1px dashed var(--ui-stroke-secondary)',
        borderRadius: '10px',
        fontSize: '12px',
        color: 'var(--ui-text-secondary)'
      },
      children: 'Select an event to inspect the normalized payload and the raw event envelope.'
    })
  }

  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '8px' },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
        children: [
          jsx('div', { style: { fontSize: '13px', fontWeight: 700 }, children: event.event_type }),
          jsx(Badge, { children: event.status })
        ]
      }),
      keyValue('Source', event.source_profile || '—'),
      keyValue('Target', event.target_profile || '—'),
      keyValue('Run', event.run_id || '—'),
      keyValue('Task', event.task_id || '—'),
      keyValue('Model', event.model || '—'),
      keyValue('Provider', event.provider || '—'),
      keyValue('Duration', formatDurationMs(event.duration_ms)),
      jsx('pre', {
        style: {
          margin: 0,
          padding: '12px',
          border: '1px solid var(--ui-stroke-secondary)',
          borderRadius: '10px',
          fontSize: '11px',
          lineHeight: 1.45,
          color: 'var(--ui-text-secondary)',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        },
        children: JSON.stringify(event, null, 2)
      }),
      jsx('pre', {
        style: {
          margin: 0,
          padding: '12px',
          border: '1px solid var(--ui-stroke-secondary)',
          borderRadius: '10px',
          fontSize: '11px',
          lineHeight: 1.45,
          color: 'var(--ui-text-secondary)',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        },
        children: JSON.stringify(event.metadata?.raw || {}, null, 2)
      })
    ]
  })
}

function MissionControlPane({ runtime }) {
  const snapshot = useRuntimeSnapshot(runtime)
  const [profileFilter, setProfileFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [showInspector, setShowInspector] = useState(false)

  const visibleEvents = useMemo(() => snapshot.events.slice(0, FEED_EVENTS), [snapshot.events])
  const profileSummary = useMemo(() => summarizeProfiles(snapshot.events), [snapshot.events])
  const handoffs = useMemo(() => deriveHandoffs(snapshot.events), [snapshot.events])
  const hints = useMemo(() => deriveHints(snapshot.events, handoffs, profileSummary), [snapshot.events, handoffs, profileSummary])
  const typeSummary = useMemo(() => summarizeTypes(snapshot.events).slice(0, FILTER_LIMIT), [snapshot.events])
  const statusSummary = useMemo(() => summarizeStatuses(snapshot.events).slice(0, FILTER_LIMIT), [snapshot.events])
  const profileOptions = useMemo(() => profileSummary.slice(0, FILTER_LIMIT).map(item => item.profile), [profileSummary])

  const filteredEvents = useMemo(
    () => filterEvents(visibleEvents, profileFilter, typeFilter, statusFilter),
    [visibleEvents, profileFilter, typeFilter, statusFilter]
  )

  const selectedEvent = useMemo(() => {
    if (!filteredEvents.length) return null
    return filteredEvents.find(event => event.event_id === selectedEventId) || filteredEvents[0]
  }, [filteredEvents, selectedEventId])

  useEffect(() => {
    if (selectedEvent && selectedEvent.event_id !== selectedEventId) {
      setSelectedEventId(selectedEvent.event_id)
    }
  }, [selectedEvent, selectedEventId])

  const totalFailures = snapshot.events.filter(event => event.status === 'failed').length
  const totalRunning = snapshot.events.filter(event => event.status === 'running' || event.status === 'active').length
  const totalCompleted = snapshot.events.filter(event => event.status === 'completed').length

  return jsxs('div', {
    style: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '12px',
      color: 'var(--ui-text-primary)'
    },
    children: [
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
        children: [
          jsxs('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px' },
            children: [
              jsx(StatusDot, { status: snapshot.captureState === 'listening' ? 'ok' : 'warn' }),
              jsx('div', { style: { fontSize: '14px', fontWeight: 700 }, children: 'Agent Mission Control' })
            ]
          }),
          jsxs('div', {
            style: { display: 'flex', gap: '8px' },
            children: [
              jsx(Button, {
                onClick: () => setShowInspector(value => !value),
                children: showInspector ? 'Hide inspector' : 'Show inspector'
              }),
              jsx(Button, {
                onClick: () => runtime.clear(),
                children: 'Clear feed'
              })
            ]
          })
        ]
      }),
      jsx(Separator, {}),
      jsx('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '8px'
        },
        children: [
          statCard('Current profile', snapshot.currentProfile, `capture ${snapshot.captureState}`),
          statCard('Events buffered', formatCount(snapshot.stats.capturedEvents), `${formatCount(filteredEvents.length)} visible after filters`),
          statCard('Handoffs seen', formatCount(snapshot.stats.handoffEvents), `${formatCount(handoffs.length)} handoff-like events in memory`),
          statCard('Failures / running', `${formatCount(totalFailures)} / ${formatCount(totalRunning)}`, `${formatCount(totalCompleted)} completed in buffer`)
        ]
      }),
      section('Live profile & persistence', jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px' },
        children: [
          keyValue('Current profile', snapshot.currentProfile),
          keyValue('Capture state', snapshot.captureState),
          keyValue('Persistence', snapshot.diagnostics.persistence),
          keyValue('Hydrated from storage', snapshot.diagnostics.hydratedFromStorage ? 'yes' : 'no'),
          keyValue('Last event', snapshot.stats.lastEventTs)
        ]
      })),
      section('Pipeline hints', jsx('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px' },
        children: hints.map((hint, index) => jsx(HintRow, { hint }, `${hint.tone}-${index}`))
      })),
      section('Profile activity cards', jsx(ScrollArea, {
        style: { maxHeight: '220px' },
        children: jsx('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '8px' },
          children: profileSummary.length
            ? profileSummary.map(item => jsx(ProfileCard, { item, active: item.profile === snapshot.currentProfile }, item.profile))
            : jsx('div', {
                style: {
                  padding: '12px',
                  border: '1px dashed var(--ui-stroke-secondary)',
                  borderRadius: '10px',
                  fontSize: '12px',
                  color: 'var(--ui-text-secondary)'
                },
                children: 'No profile activity cards yet.'
              })
        })
      })),
      section('Recent handoffs', jsx(ScrollArea, {
        style: { maxHeight: '180px' },
        children: jsx('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '8px' },
          children: handoffs.length
            ? handoffs.slice(0, 8).map(event => jsx(HandoffCard, { event }, event.event_id))
            : jsx('div', {
                style: {
                  padding: '12px',
                  border: '1px dashed var(--ui-stroke-secondary)',
                  borderRadius: '10px',
                  fontSize: '12px',
                  color: 'var(--ui-text-secondary)'
                },
                children: 'No handoff-like events have been recognized yet.'
              })
        })
      })),
      section('Filters', jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '10px' },
        children: [
          jsxs('div', {
            style: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
            children: [
              chipButton('Profile: all', profileFilter === 'all', () => setProfileFilter('all')),
              ...profileOptions.map(profile => chipButton(`Profile: ${profile}`, profileFilter === profile, () => setProfileFilter(profile)))
            ]
          }),
          jsxs('div', {
            style: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
            children: [
              chipButton('Type: all', typeFilter === 'all', () => setTypeFilter('all')),
              ...typeSummary.map(([type, count]) => chipButton(`${type} (${count})`, typeFilter === type, () => setTypeFilter(type)))
            ]
          }),
          jsxs('div', {
            style: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
            children: [
              chipButton('Status: all', statusFilter === 'all', () => setStatusFilter('all')),
              ...statusSummary.map(([status, count]) => chipButton(`${status} (${count})`, statusFilter === status, () => setStatusFilter(status)))
            ]
          })
        ]
      })),
      section('Recent normalized events', jsx(ScrollArea, {
        style: { minHeight: showInspector ? '220px' : 0, flex: showInspector ? '0 0 auto' : 1, maxHeight: showInspector ? '260px' : 'none' },
        children: jsx('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '8px' },
          children: filteredEvents.length
            ? filteredEvents.map(item => jsx(EventRow, {
                item,
                selected: selectedEvent?.event_id === item.event_id,
                onSelect: event => {
                  setSelectedEventId(event.event_id)
                  setShowInspector(true)
                }
              }, item.event_id))
            : jsx('div', {
                style: {
                  padding: '12px',
                  border: '1px dashed var(--ui-stroke-secondary)',
                  borderRadius: '10px',
                  fontSize: '12px',
                  color: 'var(--ui-text-secondary)'
                },
                children: 'No events match the current filters.'
              })
        })
      })),
      }),
      showInspector
        ? section('Raw event inspector', jsx(ScrollArea, {
            style: { minHeight: '220px', maxHeight: '420px' },
            children: jsx(RawInspector, { event: selectedEvent })
          }))
        : null,
      section('Adapter health', jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px' },
        children: Object.entries(snapshot.adapters).map(([name, state]) => jsx('div', {
          children: keyValue(name, state)
        }, name))
      })),
      snapshot.diagnostics.lastError
        ? section('Diagnostics', jsx('div', {
            style: {
              padding: '10px 12px',
              border: '1px solid var(--ui-stroke-secondary)',
              borderRadius: '10px',
              fontSize: '12px',
              color: 'var(--ui-text-secondary)',
              lineHeight: 1.4
            },
            children: snapshot.diagnostics.lastError
          }))
        : null
    ]
  })
}

function StatusChip({ runtime }) {
  const snapshot = useRuntimeSnapshot(runtime)
  return jsxs('div', {
    style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' },
    children: [
      jsx(StatusDot, { status: snapshot.captureState === 'listening' ? 'ok' : 'warn' }),
      jsx('span', { children: `Mission Control · ${snapshot.currentProfile} · ${snapshot.stats.capturedEvents} ev · ${snapshot.stats.handoffEvents} hf` })
    ]
  })
}

export default {
  id: PLUGIN_ID,
  name: 'Agent Mission Control',
  defaultEnabled: false,
  register(ctx) {
    const runtime = ensureRuntime(ctx)

    ctx.register({
      id: `${PLUGIN_ID}-pane`,
      area: 'panes',
      title: 'Mission Control',
      data: {
        placement: 'right',
        width: '420px'
      },
      render: () => jsx(MissionControlPane, { runtime })
    })

    ctx.register({
      id: `${PLUGIN_ID}-status`,
      area: 'statusBar.right',
      order: 100,
      render: () => jsx(StatusChip, { runtime })
    })
  }
}
