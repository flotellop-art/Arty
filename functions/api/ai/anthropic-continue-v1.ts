import type { Env } from '../../env'
import { onRequestPost as proxy } from './proxy'
import { ANTHROPIC_REQUIRE_FUNDING_HEADER, parseAnthropicFunding } from '../../../shared/anthropicFunding'

/** Never fall back to the legacy proxy: an older deployment must not ignore
 * a new continuation's funding restriction and silently charge another source. */
export const onRequestPost: PagesFunction<Env> = context => {
  if (!parseAnthropicFunding(context.request.headers.get(ANTHROPIC_REQUIRE_FUNDING_HEADER))) {
    return Response.json({ error: 'continuation_funding_required' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  return proxy(context)
}
