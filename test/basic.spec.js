// eslint-disable-next-line import/no-extraneous-dependencies
import { expect, test, beforeAll } from 'vitest'
import { api } from './util/api'

beforeAll(async () => {
  // Nothing to do
})

test('Ping', async () => {
  const res = await api.get('ping')
  expect(res.status).toBe(200)
  expect(await res.text()).toBe('pong')
})

