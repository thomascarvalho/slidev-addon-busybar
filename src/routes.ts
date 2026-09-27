/* The `/__busy/*` routes the browser posts to: each one reads its body,
   answers at once (the slides never wait for the bar) and acts. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TimerAction } from './timer.ts'
import type { Schedule, SlideInfo } from './types.ts'
import { isTimerAction, parseSchedule, parseSlide, readJson, reply } from './requests.ts'

export interface Actions {
  slide: (slide: SlideInfo) => void
  schedule: (schedule: Schedule) => void
  timer: (action: TimerAction) => void
}

interface Route<T> {
  parse: (body: Record<string, unknown>) => T | null
  act: (value: T) => void
}

const route = <T>(parse: Route<T>['parse'], act: Route<T>['act']): Route<T> => ({ parse, act })

export function createRoutes(actions: Actions) {
  const routes: Record<string, Route<unknown>> = {
    '/slide': route(parseSlide, actions.slide),
    '/schedule': route(parseSchedule, actions.schedule),
    '/timer': route(body => isTimerAction(body.action) ? body.action : null, actions.timer),
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'POST')
      return reply(res, 405)
    const found = routes[req.url ?? '']
    if (!found)
      return reply(res, 404)
    const body = await readJson(req)
    const value = body && found.parse(body)
    if (value === null || value === undefined)
      return reply(res, 400)
    reply(res, 204)
    found.act(value)
  }
}
