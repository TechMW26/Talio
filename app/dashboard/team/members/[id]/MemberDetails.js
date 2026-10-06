'use client'

import { NativeButton, Heading2, Heading3 } from '@/components/ui/fernly/native'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { formatDesignation } from '@/lib/formatters'
import styles from './member.module.css'
const display = value => {
  if (value == null || value === '') return 'Not recorded'
  if (Array.isArray(value)) return value.map(display).join(', ') || 'Not recorded'
  if (typeof value === 'object') return value.name || value.title || [value.firstName, value.lastName].filter(Boolean).join(' ') || 'Not recorded'
  return String(value).replaceAll('_', ' ')
}
export default function MemberDetails({ employee, assetsOnly = false }) {
  const { data, error, isLoading, mutate } = useAuthedSWR(assetsOnly ? `/api/assets?employeeId=${encodeURIComponent(employee._id)}` : `/api/employees/${encodeURIComponent(employee._id)}`, { revalidateOnFocus: false })
  if (isLoading) return <p role="status">Loading {assetsOnly ? 'assigned assets' : 'employee details'}…</p>
  if (error) return <div role="alert"><p>{error.status === 403 ? 'Your account does not have permission to view this section.' : 'Unable to load this section.'}</p><NativeButton onClick={() => mutate()}>Retry</NativeButton></div>
  if (assetsOnly) {
    const assets = (data?.data || []).filter(asset => String(asset.assignedTo?._id || asset.assignedTo) === employee._id)
    return <section className={styles.section}><Heading2>Assigned assets · {assets.length}</Heading2>{!assets.length ? <p>No assigned assets visible to your account.</p> : <div className={styles.detailGrid}>{assets.map(asset => <article key={asset._id} className={styles.detailCard}><Heading3>{asset.name || asset.assetName || asset.assetCode || 'Asset'}</Heading3><dl>{[['Code',asset.assetCode],['Category',asset.category],['Brand',asset.brand],['Model',asset.model],['Serial number',asset.serialNumber],['Status',asset.status],['Condition',asset.condition],['Assigned on',asset.assignedDate || asset.assignedAt]].map(([title,value]) => <div key={title}><dt>{title}</dt><dd>{display(value)}</dd></div>)}</dl></article>)}</div>}</section>
  }
  const person = { ...employee, ...data?.data }
  const groups = [
    ['Organization', [['Employee code',person.employeeCode],['Company',person.company],['Department',person.department],['Additional departments',person.departments],['Teams',employee.teams],['Post / designation',formatDesignation(person.designation, person)],['Employment type',person.employmentType],['Status',person.status],['Work location',person.workLocation],['Reporting manager',employee.reportingManager],['Assigned manager',employee.managerName],['Team lead',employee.teamLeadName]]],
    ['Contact & profile', [['Email',person.email],['Phone',person.phone],['Joining date',person.dateOfJoining ? String(person.dateOfJoining).slice(0,10) : null],['Biography',person.bio],['Skills',person.skills],['Qualifications',person.qualifications],['Experience',person.experience]]],
  ]
  return <div className={styles.detailGrid}>{groups.map(([title, fields]) => <section className={styles.detailCard} key={title}><Heading2>{title}</Heading2><dl>{fields.map(([name,value]) => <div key={name}><dt>{name}</dt><dd>{display(value)}</dd></div>)}</dl></section>)}<p className={styles.detailNote}>Details are limited to the fields your account is permitted to view. Payroll, bank and identity documents remain in their protected workflows.</p></div>
}
