import {
  formatAssetStatus,
  getAssetDisplayDetails,
  normalizeAssetInput,
  normalizeAssetStatus,
} from '@/utils/assetData'
import fs from 'fs'
import path from 'path'

describe('asset data normalization', () => {
  test('maps canonical saved fields to the inventory and dashboard display', () => {
    expect(getAssetDisplayDetails({
      name: 'MacBook Pro',
      assetCode: 'TAL-101',
      category: 'laptop',
      manufacturer: 'Apple',
      status: 'assigned',
    })).toEqual({
      name: 'MacBook Pro',
      code: 'TAL-101',
      category: 'laptop',
      manufacturer: 'Apple',
      status: 'assigned',
    })
  })

  test('keeps legacy records visible and normalizes legacy statuses', () => {
    expect(getAssetDisplayDetails({
      assetName: 'Desk monitor',
      assetId: 'OLD-12',
      assetType: 'monitor',
      brand: 'Dell',
      status: 'maintenance',
    })).toMatchObject({
      name: 'Desk monitor',
      code: 'OLD-12',
      category: 'monitor',
      manufacturer: 'Dell',
      status: 'under-maintenance',
    })
    expect(normalizeAssetStatus('retired')).toBe('disposed')
    expect(formatAssetStatus('under-maintenance')).toBe('Under Maintenance')
  })

  test('trims create values, removes empty optional fields, and synchronizes assignment', () => {
    const result = normalizeAssetInput({
      name: '  MacBook Pro  ',
      assetCode: ' TAL-101 ',
      category: 'LAPTOP',
      uin: '',
      assignedTo: ' employee-1 ',
      status: 'available',
      purchasePrice: '120000',
    })

    expect(result.errors).toEqual([])
    expect(result.data).toEqual({
      name: 'MacBook Pro',
      assetCode: 'TAL-101',
      category: 'laptop',
      assignedTo: 'employee-1',
      status: 'assigned',
      purchasePrice: 120000,
    })
  })

  test('supports clearing optional values and unassigning during an edit', () => {
    expect(normalizeAssetInput({
      assignedTo: '',
      status: 'available',
      description: '',
      purchaseDate: '',
    }, { partial: true })).toEqual({
      data: {
        assignedTo: null,
        status: 'available',
        description: null,
        purchaseDate: null,
      },
      errors: [],
    })
  })

  test('keeps canonical asset fields in both inventory and unified dashboard contracts', () => {
    const pageSource = fs.readFileSync(path.join(process.cwd(), 'app/dashboard/assets/page.js'), 'utf8')
    const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'app/api/dashboard/unified/route.js'), 'utf8')
    const updateRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/assets/[id]/route.js'), 'utf8')

    expect(pageSource).toContain('getAssetDisplayDetails(asset)')
    expect(pageSource).toContain('Edit or Reassign')
    expect(pageSource).toContain('`/api/assets/${selectedAsset._id}`')
    expect(dashboardSource).toContain(".select('name assetCode category uin serialNumber manufacturer model status')")
    expect(updateRouteSource).toContain('const { id } = await params')
    expect(updateRouteSource).toContain("emitAssetUpdate(asset, [], { action: 'update', broadcast: true })")
  })

  test.each([
    [{ name: '', assetCode: 'A-1', category: 'laptop' }, 'Asset name is required'],
    [{ name: 'Laptop', assetCode: '', category: 'laptop' }, 'Asset code is required'],
    [{ name: 'Laptop', assetCode: 'A-1', category: 'spaceship' }, 'Select a valid asset category'],
    [{ name: 'Laptop', assetCode: 'A-1', category: 'laptop', status: 'missing' }, 'Select a valid asset status'],
    [{ name: 'Laptop', assetCode: 'A-1', category: 'laptop', status: 'assigned' }, 'Select an employee before marking an asset as assigned'],
    [{ name: 'Laptop', assetCode: 'A-1', category: 'laptop', purchasePrice: '-1' }, 'Purchase price must be zero or greater'],
  ])('rejects invalid create input %#', (input, message) => {
    expect(normalizeAssetInput(input).errors).toContain(message)
  })
})
