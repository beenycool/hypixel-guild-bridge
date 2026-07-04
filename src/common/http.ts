import http from 'node:http'
import https from 'node:https'

import axios from 'axios'

export const httpClient = axios.create({
  timeout: 15_000,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  maxRedirects: 5
})

export default httpClient
