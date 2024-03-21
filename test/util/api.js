const baseUrl = 'http://localhost:8000'

export const api = {
  get: async (endpoint) => {
    const res = await fetch(`${baseUrl}/${endpoint}`)
    return res
  },
  post: async (endpoint, body) => {
    const res = await fetch(`${baseUrl}/${endpoint}`, {
      body: JSON.stringify(body),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })
    return res
  },
}
