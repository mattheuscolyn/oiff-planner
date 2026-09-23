/**
 * Run generatePlanV3 in a Web Worker so React can repaint progress.
 */

import { deriveFestivalAvailability } from '../utils/festivalAvailability'
import { getFerries } from '../utils/ferryData'
import { DEFAULT_TIME_BUDGET_MS } from './optimizerV3'

let nextRequestId = 1
let sharedWorker = null

function getWorker() {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./optimizerWorker.js', import.meta.url), {
      type: 'module'
    })
  }
  return sharedWorker
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
  const worker = getWorker()

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      if (signal) signal.removeEventListener('abort', onAbort)
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
