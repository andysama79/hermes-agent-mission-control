import React, { useEffect, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Badge, Button, ScrollArea, Separator, StatusDot } from '@hermes/plugin-sdk'

const PLUGIN_ID = 'agent-mission-control'
const STORAGE_KEY = 'recent-events'
const MAX_EVENTS = 50
const PROFILE_POLL_MS = 3000

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

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

function buildEvent(rawEvent, fallbackProfile, sequence) {
  const rawType = safeString(rawEvent?.type || rawEvent?.event || rawEvent?.name, 'desktop.event')
  const text = JSON.stringify(rawEvent || {}).toLowerCase()
  let eventType = rawType
  if (text.includes('delegate')) eventType = text.includes('complete') ? 'delegate.completed' : 'delegate.started'
  if (text.includes('cron')) eventType = text.includes('complete') ? 'cron.completed' : 'cron.started'
  if (text.includes('process')) eventType = text.includes('exit') || text.includes('complete') ? 'process.completed' : 'process.started'
  if (text.includes('error') || text.includes('exception')) eventType = 'error.observed'

  let status = 'observed'
  if (text.includes('fail') || text.includes('error')) status = 'failed'
  else if (text.includes('complete') || text.includes('done') || text.includes('success')) status = 'completed'
  else if (text.includes('start') || text.includes('run') || text.includes('active')) status = 'running'

  return {
    event_id: `evt-${Date.now()}-${sequence}`,
    ts: safeString(firstDefined(rawEvent?.ts, rawEvent?.timestamp, rawEvent?.created_at), isoNow()),
    event_type: eventType,
    source_profile: safeString(firstDefined(rawEvent?.source_profile, rawEvent?.profile, rawEvent?.profile_name, fallbackProfile), fallbackProfile),
    target_profile: firstDefined(rawEvent?.target_profile, rawEvent?.to_profile, rawEvent?.worker_profile),
    session_id: firstDefined(rawEvent?.session_id, rawEvent?.sessionId),
    run_id: firstDefined(rawEvent?.run_id, rawEvent?.runId, rawEvent?.delegation_id, rawEvent?.process_id, rawEvent?.job_id),
    task_id: firstDefined(rawEvent?.task_id, rawEvent?.taskId, rawEvent?.kanban_task_id),
    status,
    model: firstDefined(rawEvent?.model, rawEvent?.model_name),
    provider: firstDefined(rawEvent?.provider, rawEvent?.provider_name),
    tokens_in: maybeNumber(firstDefined(rawEvent?.tokens_in, rawEvent?.prompt_tokens, rawEvent?.input_tokens)),
    tokens_out: maybeNumber(firstDefined(rawEvent?.tokens_out, rawEvent?.completion_tokens, rawEvent?.output_tokens)),
    estimated_cost_usd: maybeNumber(firstDefined(rawEvent?.estimated_cost_usd, rawEvent?.cost_usd)),
    duration_ms: maybeNumber(firstDefined(rawEvent?.duration_ms, rawEvent?.elapsed_ms)),
    metadata: {
      raw_event_type: rawType,
      summary: safeString(firstDefined(rawEvent?.title, rawEvent?.message, rawEvent?.summary, ''), ''),
      raw: rawEvent || {}
    }
  }
}

function buildProfileEvent(profileName, previousProfile, sequence) {
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
      summary: previousProfile ? `Profile switched from ${previousProfile} to ${profileName}` : `Observed active profile ${profileName}`,
      raw: {
        previous_profile: previousProfile || null,
        profile: profileName
      }
    }
  }
}

function createSnapshot() {
  return {
    captureState: 'booting',
    currentProfile: 'unknown',
    events: [],
    diagnostics: {
      persistence: 'unknown',
      hydratedFromStorage: false,
      lastError: null
    }
  }
}

function createRuntime(ctx) {
  const { host, storage } = ctx
  const listeners = new Set()
  const snapshot = createSnapshot()
  let disposeHost = null
  let profileInterval = null
  let sequence = 0
  let started = false
  let lastObservedProfile = safeString(host.state.profile?.get?.(), 'default')

  function emit() {
    listeners.forEach(listener => listener({ ...snapshot }))
  }

  function persist() {
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
    emit()
    persist()
  }

  function observeProfile(force = false) {
    const profileName = safeString(host.state.profile?.get?.(), 'default')
    snapshot.currentProfile = profileName
    if (force || profileName !== lastObservedProfile) {
      sequence += 1
      pushEvent(buildProfileEvent(profileName, force ? null : lastObservedProfile, sequence))
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
          }
          snapshot.diagnostics.persistence = 'ready'
          emit()
        })
        .catch(error => {
          snapshot.diagnostics.persistence = 'error'
          snapshot.diagnostics.lastError = `storage.get failed: ${String(error)}`
          emit()
        })
        .finally(() => observeProfile(true))
    } else {
      snapshot.diagnostics.persistence = 'unavailable'
      observeProfile(true)
    }

    try {
      disposeHost = host.onEvent('*', rawEvent => {
        sequence += 1
        snapshot.captureState = 'listening'
        const profileName = safeString(host.state.profile?.get?.(), snapshot.currentProfile || 'default')
        pushEvent(buildEvent(rawEvent, profileName, sequence))
      })
    } catch (error) {
      snapshot.captureState = 'degraded'
      snapshot.diagnostics.lastError = `host.onEvent subscription failed: ${String(error)}`
      emit()
    }

    profileInterval = setInterval(() => observeProfile(false), PROFILE_POLL_MS)
  }

  return {
    start,
    clear() {
      snapshot.events = []
      emit()
      persist()
    },
    getSnapshot() {
      return { ...snapshot }
    },
    subscribe(listener) {
      listeners.add(listener)
      listener({ ...snapshot })
      return () => listeners.delete(listener)
    },
    stop() {
      if (typeof disposeHost === 'function') disposeHost()
      if (profileInterval) clearInterval(profileInterval)
    }
  }
}

function ensureRuntime(ctx) {
  if (!runtimeSingleton) runtimeSingleton = createRuntime(ctx)
  runtimeSingleton.start()
  return runtimeSingleton
}

function useRuntimeSnapshot(runtime) {
  const [snapshot, setSnapshot] = useState(runtime.getSnapshot())
  useEffect(() => runtime.subscribe(setSnapshot), [runtime])
  return snapshot
}

function section(title, child) {
  return jsxs('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '8px' },
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
      child
    ]
  })
}

function keyValue(label, value) {
  return jsxs('div', {
    style: { display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px' },
    children: [
      jsx('span', { style: { color: 'var(--ui-text-tertiary)' }, children: label }),
      jsx('span', { style: { color: 'var(--ui-text-primary)' }, children: value })
    ]
  })
}

function EventRow({ item }) {
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
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
        children: [
          jsx('div', { style: { fontSize: '13px', color: 'var(--ui-text-primary)', fontWeight: 600 }, children: item.event_type }),
          jsx(Badge, { children: item.status })
        ]
      }),
      jsxs('div', {
        style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', color: 'var(--ui-text-secondary)' },
        children: [
          jsx('span', { children: item.source_profile || 'unknown-profile' }),
          jsx('span', { children: item.ts })
        ]
      })
    ]
  })
}

function MissionControlPane({ runtime }) {
  const snapshot = useRuntimeSnapshot(runtime)
  const lastEventTs = useMemo(() => (snapshot.events[0] ? snapshot.events[0].ts : 'none yet'), [snapshot.events])

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
          jsx(Button, {
            onClick: () => runtime.clear(),
            children: 'Clear feed'
          })
        ]
      }),
      jsx(Separator, {}),
      section('Live profile', jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px' },
        children: [
          keyValue('Current profile', snapshot.currentProfile),
          keyValue('Capture state', snapshot.captureState),
          keyValue('Events captured', String(snapshot.events.length)),
          keyValue('Last event', lastEventTs)
        ]
      })),
      section('Diagnostics', jsxs('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px' },
        children: [
          keyValue('Persistence', snapshot.diagnostics.persistence),
          keyValue('Hydrated from storage', snapshot.diagnostics.hydratedFromStorage ? 'yes' : 'no'),
          keyValue('Last error', snapshot.diagnostics.lastError || 'none')
        ]
      })),
      section('Recent normalized events', jsx(ScrollArea, {
        style: { minHeight: 0, flex: 1 },
        children: jsxs('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '8px' },
          children: snapshot.events.length
            ? snapshot.events.map(item => jsx(EventRow, { item }, item.event_id))
            : [jsx('div', {
                key: 'empty',
                style: {
                  padding: '12px',
                  border: '1px dashed var(--ui-stroke-secondary)',
                  borderRadius: '10px',
                  fontSize: '12px',
                  color: 'var(--ui-text-secondary)'
                },
                children: 'Waiting for Hermes desktop events. This runtime captures a rolling recent-event buffer and persists it when ctx.storage is available.'
              })]
        })
      }))
    ]
  })
}

function StatusChip({ runtime }) {
  const snapshot = useRuntimeSnapshot(runtime)
  return jsxs('div', {
    style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' },
    children: [
      jsx(StatusDot, { status: snapshot.captureState === 'listening' ? 'ok' : 'warn' }),
      jsx('span', { children: `Mission Control · ${snapshot.currentProfile}` })
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
        width: '380px'
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
