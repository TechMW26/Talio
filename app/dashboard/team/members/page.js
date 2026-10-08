'use client'


import { Heading1, NativeSelect, NativeInput, NativeButton, Heading2 } from '@/components/ui/fernly/native'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { FaSearch, FaChevronLeft, FaChevronRight, FaUsers, FaCrown } from 'react-icons/fa'
import { formatDesignation } from '@/lib/formatters'
import { useAuthedSWRInfinite } from '@/hooks/useAuthedSWR'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { getTeamChat } from '@/lib/client/teamChat'
import styles from './team.module.css'

export default function TeamMembersPage() {
  const [department, setDepartment] = useState('all')
  const [team, setTeam] = useState('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timeout = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])
  const slider = useRef(null)
  const chatPending = useRef(false)
  const [openingChat, setOpeningChat] = useState(null)
  const [chatError, setChatError] = useState('')
  const { openChat } = useChatWidget()
  const startChat = async employeeId => {
    if (chatPending.current) return
    chatPending.current = true
    setOpeningChat(employeeId)
    setChatError('')
    try { openChat(await getTeamChat(employeeId)) }
    catch (error) { setChatError(error.message || 'Unable to open chat. Please try again.') }
    finally { chatPending.current = false; setOpeningChat(null) }
  }
  const reduceMotion = useReducedMotion()
  const params = new URLSearchParams()
  params.set('limit', '24')
  if (department !== 'all') params.set('department', department)
  if (team !== 'all') params.set('team', team)
  if (query) params.set('search', query)
  const baseKey = `/api/team/members?${params}`
  const current = useAuthedSWRInfinite((index, previous) => {
    if (index && !previous?.pagination?.nextCursor) return null
    return index ? `${baseKey}&cursor=${encodeURIComponent(previous.pagination.nextCursor)}` : baseKey
  }, { keepPreviousData: false })
  const metadata = useRef({})
  if (current.data?.[0]?.meta) metadata.current = current.data[0].meta
  const departments = metadata.current.departments || []
  const teams = (metadata.current.teams || []).filter(item => department === 'all' || (item.department?._id || item.department) === department)
  const pages = current.data || []
  const members = [...new Map(pages.flatMap(page => page.data || []).map(member => [member._id, member])).values()]
  const hasMore = Boolean(pages.at(-1)?.pagination?.hasMore)
  const loadingMore = current.isLoading || (current.isValidating && current.size > pages.length)
  const scroll = direction => slider.current?.scrollBy({ left: direction * 240, behavior: reduceMotion ? 'auto' : 'smooth' })
  return (
    <section className={styles.page} aria-labelledby="team-title">
      <header className={styles.header}>
        <div><Heading1 id="team-title">Team</Heading1><p>Your people, their roles, and the teams that bring it all together.</p></div>
        <label className={styles.department}>Department
          <NativeSelect aria-label="Department" value={department} onChange={event => { setDepartment(event.target.value); setTeam('all') }}>
            <option value="all">All departments</option>
            {departments.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}
          </NativeSelect>
        </label>
      </header>
      <label className={styles.search}><FaSearch size={18} aria-hidden="true" /><NativeInput aria-label="Search people" placeholder="Search people, code or email…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <LayoutGroup id="talio-team-directory">
        {chatError && <p role="alert" className="text-danger text-sm mt-4">{chatError}</p>}
        <div className={styles.toolbar}>
          <div className={styles.switcher}>
            {teams.length > 2 && <NativeButton className={styles.scroll} aria-label="Scroll teams left" onClick={() => scroll(-1)}><FaChevronLeft size={18} /></NativeButton>}
            <div className={styles.tabs} ref={slider} role="group" aria-label="Filter by team">
              {[{ _id: 'all', teamName: 'All teams' }, ...teams].map(item => <NativeButton key={item._id} aria-pressed={team === item._id} onClick={event => { setTeam(item._id); event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }) }}>
                {team === item._id && <motion.span className={styles.selection} layoutId="selected-team" transition={{ duration: reduceMotion ? 0 : .55, ease: [.22, 1, .36, 1] }} />}
                <span className={styles.tabLabel}>{item.teamName}</span>
              </NativeButton>)}
            </div>
            {teams.length > 2 && <NativeButton className={styles.scroll} aria-label="Scroll teams right" onClick={() => scroll(1)}><FaChevronRight size={18} /></NativeButton>}
          </div>
          <span className={styles.count} role="status">{current.isLoading ? 'Loading members…' : `${members.length} members loaded`}{current.isValidating && !current.isLoading ? ' · Updating…' : ''}</span>
        </div>
        {current.error && !members.length ? <div className={styles.empty} role="alert"><Heading2>Unable to load your team</Heading2><p>Please try again.</p><NativeButton onClick={() => current.mutate()}>Retry</NativeButton></div>
          : current.isLoading ? <div className={styles.grid} aria-label="Loading team members" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div className={`${styles.card} ${styles.skeleton}`} key={i}><div /><p /><p /><p /></div>)}</div>
          : !members.length ? <div className={styles.empty}><FaUsers size={32} /><Heading2>{hasMore ? 'Continue searching members' : 'No team members found'}</Heading2><p>{hasMore ? 'Load the next batch to continue this search.' : search ? 'Try another name, employee code or email.' : 'There are no members in this selection yet.'}</p></div>
          : <div className={styles.grid}>{members.map((member, index) => {
            const name = [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Team member'
            const joined = member.dateOfJoining ? new Date(member.dateOfJoining) : null
            return <motion.article layout={!reduceMotion} initial={reduceMotion ? false : { opacity: 0, y: 24, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: reduceMotion ? 0 : .6, ease: [.22, 1, .36, 1], opacity: { delay: Math.min(index, 8) * .035 } }} className={styles.card} key={member._id}>
              <div className={styles.avatar}>
                <span>{`${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}` || '?'}</span>
                {member.profilePicture && <img src={member.profilePicture} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden' }} />}
                {member.isDepartmentHead && <i title={`Head of ${member.headOfDepartment || 'Department'}`}><FaCrown size={13} /></i>}
              </div>
              <Heading2>{name}</Heading2><p className={styles.role}>{formatDesignation(member.designation, member) || 'Team member'}</p>
              <span className={styles.badge}>{member.department?.name || member.headOfDepartment || 'Team'}</span>
              <dl className={styles.stats}><div><dt>Employee code</dt><dd>{member.employeeCode || '—'}</dd></div><div><dt>Joined</dt><dd>{joined && !Number.isNaN(joined.getTime()) ? joined.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}</dd></div></dl>
              <div className={styles.contact}><span title={member.email}>{member.email || 'Email not provided'}</span><span>{member.phone || 'Phone not provided'}</span></div>
              {!!member.skills?.length && <div className={styles.skills}>{member.skills.slice(0, 3).map((skill, i) => <span key={i}>{typeof skill === 'string' ? skill : skill.name}</span>)}{member.skills.length > 3 && <span>+{member.skills.length - 3} more</span>}</div>}
              <footer className={styles.actions}><NativeButton type="button" disabled={openingChat !== null} aria-label={`Chat with ${name}`} aria-busy={openingChat === member._id} onClick={() => startChat(member._id)}>{openingChat === member._id ? 'Opening…' : 'Chat'}</NativeButton><Link href={`/dashboard/team/members/${member._id}`} aria-label={`View ${name}'s profile and reviews`}>Profile <FaChevronRight size={14} /></Link></footer>
            </motion.article>
          })}</div>}
        {(hasMore || (current.error && members.length > 0)) && <footer className={styles.pagination}>
          {current.error && <p role="alert">Could not load more members. Your loaded cards are still available.</p>}
          <NativeButton disabled={loadingMore} aria-busy={loadingMore} onClick={() => current.error ? current.mutate() : current.setSize(current.size + 1)}>{loadingMore ? 'Loading more…' : current.error ? 'Retry loading more' : 'Load more'}</NativeButton>
        </footer>}
      </LayoutGroup>
    </section>
  )
}
