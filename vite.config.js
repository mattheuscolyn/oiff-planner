import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Production is served from https://mattheuscolyn.github.io/oiff-planner/
  // Local `npm run dev` still serves from `/`.
  base: '/oiff-planner/',
})
