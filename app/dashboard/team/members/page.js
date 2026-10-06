'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { Search, ChevronLeft, ChevronRight, Users, Crown } from 'lucide-react'
import { formatDesignation } from '@/lib/formatters'
import useAuthedSWR from '@/hooks/useAuthedSWR'
import { useChatWidget } from '@/contexts/ChatWidgetContext'
import { getTeamChat } from '@/lib/client/teamChat'
import styles from './team.module.css'

export default function TeamMembersPage() {
  const [department, setDepartment] = useState('all')
  const [team, setTeam] = useState('all')
  const [search, setSearch] = useState('')
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
  // Stable metadata prevents the department/team controls disappearing on selection.
  const directory = useAuthedSWR('/api/team/members')
  const params = new URLSearchParams()
  if (department !== 'all') params.set('department', department)
  if (team !== 'all') params.set('team', team)
  const filteredKey = params.size ? `/api/team/members?${params}` : null
  const filtered = useAuthedSWR(filteredKey, { keepPreviousData: false })
  const current = filteredKey ? filtered : directory
  const departments = directory.data?.meta?.departments || []
  const teams = (directory.data?.meta?.teams || []).filter(item => department === 'all' || (item.department?._id || item.department) === department)
  const members = (current.data?.data || []).filter(member =>
    [member.firstName, member.lastName, member.employeeCode, member.email, formatDesignation(member.designation, member)]
      .filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  const scroll = direction => slider.current?.scrollBy({ left: direction * 240, behavior: reduceMotion ? 'auto' : 'smooth' })
  return (
    <section className={styles.page} aria-labelledby="team-title">
      <header className={styles.header}>
        <div><h1 id="team-title">Team</h1><p>Your people, their roles, and the teams that bring it all together.</p></div>
        <label className={styles.department}>Department
          <select aria-label="Department" value={department} onChange={event => { setDepartment(event.target.value); setTeam('all') }}>
            <option value="all">All departments</option>
            {departments.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}
          </select>
        </label>
      </header>
      <label className={styles.search}><Search size={18} aria-hidden="true" /><input aria-label="Search people" placeholder="Search people, code or email…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <LayoutGroup id="talio-team-directory">
        {chatError && <p role="alert" className="text-danger text-sm mt-4">{chatError}</p>}
        <div className={styles.toolbar}>
          <div className={styles.switcher}>
            {teams.length > 2 && <button className={styles.scroll} aria-label="Scroll teams left" onClick={() => scroll(-1)}><ChevronLeft size={18} /></button>}
            <div className={styles.tabs} ref={slider} role="group" aria-label="Filter by team">
              {[{ _id: 'all', teamName: 'All teams' }, ...teams].map(item => <button key={item._id} aria-pressed={team === item._id} onClick={event => { setTeam(item._id); event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }) }}>
                {team === item._id && <motion.span className={styles.selection} layoutId="selected-team" transition={{ duration: reduceMotion ? 0 : .55, ease: [.22, 1, .36, 1] }} />}
                <span className={styles.tabLabel}>{item.teamName}</span>
              </button>)}
            </div>
            {teams.length > 2 && <button className={styles.scroll} aria-label="Scroll teams right" onClick={() => scroll(1)}><ChevronRight size={18} /></button>}
          </div>
          <span className={styles.count} role="status">{current.isLoading ? 'Loading members…' : `${members.length} members`}{current.isValidating && !current.isLoading ? ' · Updating…' : ''}</span>
        </div>
        {directory.error || current.error ? <div className={styles.empty} role="alert"><h2>Unable to load your team</h2><p>Please try again.</p><button onClick={() => { directory.mutate(); if (filteredKey) filtered.mutate() }}>Retry</button></div>
          : current.isLoading ? <div className={styles.grid} aria-label="Loading team members" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div className={`${styles.card} ${styles.skeleton}`} key={i}><div /><p /><p /><p /></div>)}</div>
          : !members.length ? <div className={styles.empty}><Users size={32} /><h2>No team members found</h2><p>{search ? 'Try another name, employee code or email.' : 'There are no members in this selection yet.'}</p></div>
          : <div className={styles.grid}>{members.map((member, index) => {
            const name = [member.firstName, member.lastName].filter(Boolean).join(' ') || 'Team member'
            const joined = member.dateOfJoining ? new Date(member.dateOfJoining) : null
            return <motion.article layout={!reduceMotion} initial={reduceMotion ? false : { opacity: 0, y: 24, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: reduceMotion ? 0 : .6, ease: [.22, 1, .36, 1], opacity: { delay: Math.min(index, 8) * .035 } }} className={styles.card} key={member._id}>
              <div className={styles.avatar}>
                <span>{`${member.firstName?.[0] || ''}${member.lastName?.[0] || ''}` || '?'}</span>
                {member.profilePicture && <img src={member.profilePicture} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden' }} />}
                {member.isDepartmentHead && <i title={`Head of ${member.headOfDepartment || 'Department'}`}><Crown size={13} /></i>}
              </div>
              <h2>{name}</h2><p className={styles.role}>{formatDesignation(member.designation, member) || 'Team member'}</p>
              <span className={styles.badge}>{member.department?.name || member.headOfDepartment || 'Team'}</span>
              <dl className={styles.stats}><div><dt>Employee code</dt><dd>{member.employeeCode || '—'}</dd></div><div><dt>Joined</dt><dd>{joined && !Number.isNaN(joined.getTime()) ? joined.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'}</dd></div></dl>
              <div className={styles.contact}><span title={member.email}>{member.email || 'Email not provided'}</span><span>{member.phone || 'Phone not provided'}</span></div>
              {!!member.skills?.length && <div className={styles.skills}>{member.skills.slice(0, 3).map((skill, i) => <span key={i}>{typeof skill === 'string' ? skill : skill.name}</span>)}{member.skills.length > 3 && <span>+{member.skills.length - 3} more</span>}</div>}
              <footer className={styles.actions}><button type="button" disabled={openingChat !== null} aria-label={`Chat with ${name}`} aria-busy={openingChat === member._id} onClick={() => startChat(member._id)}>{openingChat === member._id ? 'Opening…' : 'Chat'}</button><Link href={`/dashboard/team/members/${member._id}`} aria-label={`View ${name}'s profile and reviews`}>Profile <ChevronRight size={14} /></Link></footer>
            </motion.article>
          })}</div>}
      </LayoutGroup>
    </section>
  )
}
