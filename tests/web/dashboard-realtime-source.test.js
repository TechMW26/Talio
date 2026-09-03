import fs from 'fs'
import path from 'path'

describe('dashboard realtime cache bridge', () => {
  test('revalidates mounted API data for every shared realtime domain event', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'contexts/SocketContext.js'), 'utf8')

    expect(source).toContain("import { markClientDataChanged } from '@/lib/clientDataSync'")
    expect(source).toContain('new Set(Object.values(REALTIME_EVENTS))')
    expect(source).toContain('markClientDataChanged(`realtime:${eventName}`)')
    expect(source).toContain('socketInstance.off(eventName, handler)')
  })

  test('runs the data-change bridge inside the configured SWR cache provider', () => {
    const providers = fs.readFileSync(path.join(process.cwd(), 'components/Providers.js'), 'utf8')
    const dataSync = fs.readFileSync(path.join(process.cwd(), 'lib/clientDataSync.js'), 'utf8')

    expect(providers).toContain('function ClientDataSyncBridge()')
    expect(providers).toContain('const { mutate } = useSWRConfig()')
    expect(providers.indexOf('<SWRConfig')).toBeLessThan(providers.indexOf('<ClientDataSyncBridge />'))
    expect(providers).toContain('revalidateAllApiQueries(mutate)')
    expect(dataSync).toContain('pendingRevalidateMutators.add(mutateFunction)')
  })

  test('covers the recruitment events emitted by the server', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'contexts/SocketContext.js'), 'utf8')
    for (const eventName of [
      'recruitment-job-created',
      'recruitment-job-updated',
      'recruitment-candidate-updated',
      'recruitment-candidate-stage-changed',
      'recruitment-interview-scheduled',
      'recruitment-interview-updated',
    ]) {
      expect(source).toContain(`'${eventName}'`)
    }
  })
})
