import type { IncomingMessage, ServerResponse } from 'node:http'
// The .js extension matters: Vercel runs this file as a plain ES module (the project is "type": "module"),
// where Node won't resolve an extensionless import and the function crashes before it runs (500
// FUNCTION_INVOCATION_FAILED). TypeScript maps the .js to server/scribe-token.ts.
import { scribeToken } from '../server/scribe-token.js'

export default function handler(request: IncomingMessage, response: ServerResponse) {
  return scribeToken(request, response)
}
