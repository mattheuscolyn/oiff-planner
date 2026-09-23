/**
 * Worker lifecycle: one Worker per request; abort terminates computation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  generateCurrentPlanAsync,
  __setWorkerFactoryForTests
} from '../runPlanInWorker'

function makeFakeWorker() {
  const listeners = {
    message: new Set(),
    error: new Set()
  }
  const worker = {
    terminated: false,
    posted: [],
    addEventListener(type, fn) {
      listeners[type]?.add(fn)
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn)
    },
    postMessage(data) {
      this.posted.push(data)
    },
    terminate() {
      this.terminated = true
    },
    emit(type, event) {
      for (const fn of [...(listeners[type] || [])]) fn(event)
    },
    emitMessage(data) {
      this.emit('message', { data })
    }
  }
  return worker
}

describe('generateCurrentPlanAsync worker lifecycle', () => {
  let workers

  beforeEach(() => {
    workers = []
    __setWorkerFactoryForTests(() => {
      const w = makeFakeWorker()
      workers.push(w)
      return w
    })
  })

  afterEach(() => {
    __setWorkerFactoryForTests(null)
  })

  const baseArgs = {
    films: [],
    screenings: [],
    interests: {},
    constraints: { excludedFilms: [], requiredFilms: [] },
    arrival: { date: '2026-10-13', type: 'already-on-island' },
    departure: { date: '2026-10-19', type: 'staying-longer' },
    timeBudgetMs: 1000
  }

  it('creates a fresh worker per request and terminates on success', async () => {
    const p = generateCurrentPlanAsync(baseArgs)
    expect(workers).toHaveLength(1)
    const w = workers[0]
    const requestId = w.posted[0].requestId

    w.emitMessage({ type: 'result', requestId, result: { filmCount: 1 } })
    await expect(p).resolves.toEqual({ filmCount: 1 })
    expect(w.terminated).toBe(true)
  })

  it('terminates the worker on abort so a replacement can start immediately', async () => {
    const controllerA = new AbortController()
    const pA = generateCurrentPlanAsync({ ...baseArgs, signal: controllerA.signal })
    expect(workers).toHaveLength(1)
    const workerA = workers[0]

    controllerA.abort()
    await expect(pA).rejects.toMatchObject({ name: 'AbortError' })
    expect(workerA.terminated).toBe(true)

    // Replacement B uses a new worker, not queued on A
    const pB = generateCurrentPlanAsync(baseArgs)
    expect(workers).toHaveLength(2)
    const workerB = workers[1]
    expect(workerB).not.toBe(workerA)
    expect(workerB.terminated).toBe(false)

    // Stale A result must not resolve anything (A already rejected)
    workerA.emitMessage({
      type: 'result',
      requestId: workerA.posted[0].requestId,
      result: { filmCount: 99, stale: true }
    })

    workerB.emitMessage({
      type: 'result',
      requestId: workerB.posted[0].requestId,
      result: { filmCount: 24 }
    })
    await expect(pB).resolves.toEqual({ filmCount: 24 })
    expect(workerB.terminated).toBe(true)
  })

  it('terminates the worker on worker error', async () => {
    const p = generateCurrentPlanAsync(baseArgs)
    const w = workers[0]
    w.emit('error', { message: 'boom' })
    await expect(p).rejects.toThrow(/boom|Worker failed/)
    expect(w.terminated).toBe(true)
  })

  it('terminates the worker on optimizer error message', async () => {
    const p = generateCurrentPlanAsync(baseArgs)
    const w = workers[0]
    w.emitMessage({
      type: 'error',
      requestId: w.posted[0].requestId,
      message: 'optimizer exploded'
    })
    await expect(p).rejects.toThrow('optimizer exploded')
    expect(w.terminated).toBe(true)
  })

  it('cleanup is idempotent (abort after success is a no-op)', async () => {
    const controller = new AbortController()
    const p = generateCurrentPlanAsync({ ...baseArgs, signal: controller.signal })
    const w = workers[0]
    const terminateSpy = vi.spyOn(w, 'terminate')

    w.emitMessage({
      type: 'result',
      requestId: w.posted[0].requestId,
      result: { ok: true }
    })
    await expect(p).resolves.toEqual({ ok: true })
    expect(terminateSpy).toHaveBeenCalledTimes(1)

    controller.abort()
    expect(terminateSpy).toHaveBeenCalledTimes(1)
  })
})
