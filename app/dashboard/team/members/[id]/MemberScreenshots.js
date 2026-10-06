'use client'

import { NativeInput } from '@/components/ui/fernly/native'
import { useState } from 'react'
import { getTodayDateString } from '@/lib/timezone'
import MemberProductivity from './MemberProductivity'
import styles from './member.module.css'
export default function MemberScreenshots({ employee }) {
  const [date, setDate] = useState(getTodayDateString)
  return <><label className={styles.datePicker}>Activity date <NativeInput type="date" value={date} max={getTodayDateString()} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setDate(event.target.value) }} /></label><MemberProductivity key={`${employee._id}-${date}`} employee={employee} date={date} /></>
}
