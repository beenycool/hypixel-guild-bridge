import http from 'node:http'
import https from 'node:https'

import { create } from 'axios'

export const httpClient = create({
  timeout: 15_000,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  maxRedirects: 5
})

export default httpClient
