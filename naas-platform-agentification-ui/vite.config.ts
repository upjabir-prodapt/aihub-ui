import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Read the single repo-root .env instead of frontend/.env, so all three
  // processes share one config file (see registry/agents.yaml's sibling
  // README section on env setup).
  envDir: '../',
})
