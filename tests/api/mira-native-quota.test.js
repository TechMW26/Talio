import { checkAndDeductMiraToken } from '@/lib/miraChatStore.server'
test('native voice retries debit once and preserve balance even at the limit', async () => {
  let row = { _id: 'usage', user: 'me', month: '2026-10', tokensUsed: 99, tokenLimit: 100 }
  const tx = { get: async () => ({ isActive: true }), list: async () => ({ records: [row] }), replace: jest.fn(async (_collection, next) => { row = next }) }
  const database = { transaction: run => run(tx) }
  expect(await checkAndDeductMiraToken(database, 'me', '2026-10', 'call-1-turn-1')).toMatchObject({ allowed: true, tokensUsed: 100 })
  expect(await checkAndDeductMiraToken(database, 'me', '2026-10', 'call-1-turn-1')).toMatchObject({ allowed: true, tokensUsed: 100 })
  expect(await checkAndDeductMiraToken(database, 'me', '2026-10', 'call-1-turn-2')).toMatchObject({ allowed: false, tokensUsed: 100 })
  expect(tx.replace).toHaveBeenCalledTimes(1)
})
