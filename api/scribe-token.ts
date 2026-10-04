import type { IncomingMessage, ServerResponse } from 'node:http'
import { scribeToken } from '../server/scribe-token'

export default function handler(request: IncomingMessage, response: ServerResponse) {
  return scribeToken(request, response)
}
