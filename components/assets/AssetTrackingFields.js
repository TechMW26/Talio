'use client'

import { Input, Select, SelectItem, Textarea } from '@heroui/react'
import { ASSET_TRACKER_FIELDS } from '@/utils/assetData'

export default function AssetTrackingFields({ values, onChange }) {
  return <fieldset className="grid grid-cols-1 md:grid-cols-2 gap-4 md:col-span-2">
    <legend className="mb-3 text-sm font-semibold">Billing, tracking and accessories</legend>
    {ASSET_TRACKER_FIELDS.filter(([key]) => !['name', 'assignedTo', 'status'].includes(key)).map(([key, label, type]) => {
      if (type === 'boolean') return <Select key={key} label={label} selectedKeys={[values[key] === true ? 'yes' : values[key] === false ? 'no' : 'unknown']} onSelectionChange={keys => onChange({ target: { name: key, value: ({ yes: true, no: false, unknown: null })[Array.from(keys)[0]] ?? null } })}>
        <SelectItem key="unknown">Not recorded</SelectItem><SelectItem key="yes">Yes</SelectItem><SelectItem key="no">No</SelectItem>
      </Select>
      if (key === 'remarks') return <Textarea key={key} className="md:col-span-2" label={label} name={key} value={values[key] || ''} onChange={onChange} />
      return <Input key={key} label={label} name={key} type={type === 'date' ? 'date' : 'text'} value={values[key] || ''} onChange={onChange} />
    })}
  </fieldset>
}
