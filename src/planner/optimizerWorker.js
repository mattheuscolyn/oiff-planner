/**
 * Web Worker entry for festival plan optimization.
 * Keeps the main thread responsive during multi-second searches.
 */

import { generatePlanV3 } from './optimizerV3'

self.onmessage = (event) => {
  const { requestId, config } = event.data || {}
  try {
    const result = generatePlanV3({
      ...config,
      onProgress: progress => {
        self.postMessage({ type: 'progress', requestId, progress })
      }
    })
    self.postMessage({ type: 'result', requestId, result })
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error?.message || String(error)
    })
  }
}
