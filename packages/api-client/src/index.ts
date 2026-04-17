import axios from 'axios'

export function createApiClient(baseURL: string) {
  return axios.create({
    baseURL,
    timeout: 15000,
  })
}
