import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

const VIRTUAL_ID = 'virtual:triage-summary'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/** Where the backend writes summary.json, relative to this frontend folder. */
const SUMMARY_CANDIDATES = ['../summary.json', './summary.json']

function findSummaryFile(root: string): string | null {
  for (const candidate of SUMMARY_CANDIDATES) {
    const file = path.resolve(root, candidate)
    if (fs.existsSync(file)) return file
  }
  return null
}

/**
 * Inlines the triage summary the backend wrote to disk, so the dashboard has data on
 * first paint without calling the API (GET /api/triage/summary re-runs summarisation).
 * A missing or malformed file resolves to an empty list rather than failing the build.
 */
function localSummary(): Plugin {
  const root = import.meta.dirname

  return {
    name: 'local-triage-summary',

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },

    load(id) {
      if (id !== RESOLVED_ID) return null
      const file = findSummaryFile(root)
      if (!file) {
        this.warn('No summary.json found next to the frontend; the feed starts empty.')
        return 'export default []'
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        const list = Array.isArray(parsed) ? parsed : (parsed?.summary ?? [])
        return `export default ${JSON.stringify(list)}`
      } catch (err) {
        this.warn(`Could not parse ${file}: ${(err as Error).message}`)
        return 'export default []'
      }
    },

    configureServer(server) {
      const file = findSummaryFile(root)
      if (!file) return
      // Re-running triage rewrites the file, so reload to pick the new summary up.
      server.watcher.add(file)
      server.watcher.on('change', (changed) => {
        if (path.resolve(changed) !== file) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localSummary()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
