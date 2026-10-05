import type { Env } from '../../env'
import { isAutonomousWeb } from '../_lib/autonomousWeb'

// Public configuration only. No endpoint, secret, residency or identity exposed.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => Response.json({
  webBackend: isAutonomousWeb(env) ? 'arty-index' : 'providers',
}, { headers: { 'Cache-Control': 'no-store' } })
