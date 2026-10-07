'use client'

import { useMemo, useState } from 'react'
import { Card, CardBody, Input, Button, NativeButton, NativeSelect, Heading2 } from '@/components/ui/fernly'
import { FaSearch } from 'react-icons/fa'
import styles from './SettingsWorkspace.module.css'

export default function SettingsWorkspace({ tabs, activeTab, onSelect, children }) {
  const [query, setQuery] = useState('')
  const visibleTabs = useMemo(() => tabs.filter(tab =>
    `${tab.name} ${tab.description} ${tab.group}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ), [tabs, query])
  const groups = useMemo(() => visibleTabs.reduce((result, tab) => {
    if (!result[tab.group]) result[tab.group] = []
    result[tab.group].push(tab)
    return result
  }, {}), [visibleTabs])
  const current = tabs.find(tab => tab.id === activeTab)

  return (
    <div className={styles.layout}>
      <Card as="aside" shadow="none" className={styles.navigation}>
        <CardBody className={styles.navigationBody}>
          <Input aria-label="Search settings" placeholder="Search settings" value={query} onValueChange={setQuery}
            size="sm" variant="flat" startContent={<FaSearch aria-hidden="true" />} isClearable onClear={() => setQuery('')}
            classNames={{ base: styles.searchField, inputWrapper: styles.search, input: styles.searchInput }} />
          <label className={styles.mobilePicker}>
            <span>Settings section</span>
            <NativeSelect value={activeTab} onChange={event => onSelect(event.target.value)}>
              {tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.name}</option>)}
            </NativeSelect>
          </label>
          <nav aria-label="Settings sections" className={styles.nav}>
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} className={styles.group}>
                <p className={styles.groupLabel}>{group}</p>
                {items.map(tab => {
                  const Icon = tab.icon
                  return <NativeButton key={tab.id} className={styles.navButton} aria-current={activeTab === tab.id ? 'page' : undefined}
                    onClick={() => onSelect(tab.id)} title={tab.description}>
                    <Icon aria-hidden="true" /><span>{tab.name}</span>
                  </NativeButton>
                })}
              </div>
            ))}
          </nav>
          {visibleTabs.length === 0 && <div className={styles.noResults}>
            <p>No settings found</p><Button size="sm" variant="light" onPress={() => setQuery('')}>Clear search</Button>
          </div>}
        </CardBody>
      </Card>

      <section className={styles.content} aria-label={current?.name || 'Settings section'}>
        {current && <>
          <div className={styles.sectionHeader}>
            <p className={styles.breadcrumb}>{current.group}</p>
            <Heading2>{current.name}</Heading2>
            <p>{current.description}</p>
          </div>
          <div className={styles.forms}>{children}</div>
        </>}
      </section>
    </div>
  )
}
