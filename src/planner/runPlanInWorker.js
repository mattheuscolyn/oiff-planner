/**
 * Run generatePlanV3 in a Web Worker so React can repaint progress.
 *
 * One Worker per request: abort/result/error always terminate that worker
 * so a replacement search is not queued behind an obsolete optimizer run.
 */

import { deriveFestivalAvailability } from '../utils/festivalAvailability'
import { getFerries } from '../utils/ferryData'
import { DEFAULT_TIME_BUDGET_MS } from './optimizerV3'

let nextRequestId = 1

/** @type {null | (() => Worker)} */
let workerFactoryOverride = null

/** Test hook — inject a Worker factory without touching the optimizer. */
export function __setWorkerFactoryForTests(factory) {
  workerFactoryOverride = factory
}

function createRequestWorker() {
  if (workerFactoryOverride) return workerFactoryOverride()
  // Vite requires this literal `new Worker(new URL(...))` pattern to emit the worker chunk.
  return new Worker(new URL('./optimizerWorker.js', import.meta.url), {
    type: 'module'
  })
}

/**
 * @returns {Promise<object>} plan result
 */
export function generateCurrentPlanAsync({
  films,
  screenings,
  interests,
  constraints,
  arrival,
  departure,
  constraintOverrides = {},
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
  onProgress = null,
  signal = null
}) {
  const ferries = getFerries()
  const { attendanceDays, availabilityByDate } = deriveFestivalAvailability(
    arrival,
    departure,
    ferries
  )

  const mergedConstraints = {
    ...constraints,
    ...constraintOverrides
  }
  delete mergedConstraints.lockedScreenings

  const requestId = nextRequestId++
  const worker = createRequestWorker()

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      if (settled) return
      settled = true
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      if (signal) signal.removeEventListener('abort', onAbort)
      try {
        worker.terminate()
      } catch {
        // ignore double-terminate
      }
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Plan generation aborted', 'AbortError'))
    }

    const onError = (err) => {
      cleanup()
      reject(err?.message ? new Error(err.message) : new Error('Worker failed'))
    }

    const onMessage = (event) => {
      const data = event.data
      if (!data || data.requestId !== requestId) return

      if (data.type === 'progress') {
        if (onProgress && data.progress) onProgress(data.progress)
        return
      }

      if (data.type === 'error') {
        cleanup()
        reject(new Error(data.message || 'Plan generation failed'))
        return
      }

      if (data.type === 'result') {
        cleanup()
        resolve(data.result)
      }
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    if (signal) {
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort)
    }

    worker.postMessage({
      requestId,
      config: {
        films,
        screenings,
        interests,
        constraints: mergedConstraints,
        attendanceConstraints: {
          attendanceDays,
          availabilityByDate
        },
        timeBudgetMs
      }
    })
  })
}
