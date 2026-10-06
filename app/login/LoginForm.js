'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { FaEye, FaEyeSlash } from 'react-icons/fa'
import './login-form.css'

export default function LoginForm({ formData, handleChange, handleSubmit, showPassword, setShowPassword, loading, rememberMe, setRememberMe }) {
  const card = useRef(null)
  useEffect(() => {
    const root = card.current
    const pupils = root.querySelectorAll('.eye-look')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const reset = () => pupils.forEach(p => { p.style.transform = '' })
    const move = (event) => {
      if (motion.matches || event.pointerType === 'touch') return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        pupils.forEach(p => {
          const b = p.getBoundingClientRect()
          const x = event.clientX - b.left - b.width / 2
          const y = event.clientY - b.top - b.height / 2
          const distance = Math.max(1, Math.hypot(x, y))
          p.style.transform = `translate(${x / distance * 3}px, ${y / distance * 2.5}px)`
        })
      })
    }
    document.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('pointerleave', reset)
    motion.addEventListener('change', reset)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('pointerleave', reset)
      motion.removeEventListener('change', reset)
    }
  }, [])
  const mood = (event) => {
    card.current.dataset.mood = showPassword ? 'revealed' : event.target.name === 'password' ? 'hidden' : event.target.name === 'email' ? 'email' : 'neutral'
  }
  return (
    <main className="talio-login">
      <div className="card" ref={card} data-mood={showPassword ? 'revealed' : 'neutral'}>
        <div className="art" aria-hidden="true">
          <div className="art-brand"><span>Your people.<br />One workspace.</span></div>
          <svg className="characters" viewBox="0 0 248 183" preserveAspectRatio="xMidYMax meet" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g className="character purple">
          <path d="M65 13h87v170H65z" fill="var(--login-blue)"/>
          <path d="m65 13 87 0-1-6-86 2z" fill="#93b4ff"/>
          <g className="face open" fill="#17151d"><g className="eye-look"><ellipse cx="92" cy="43" rx="2.5" ry="4"/><ellipse cx="121" cy="43" rx="2.5" ry="4"/></g><ellipse cx="107" cy="61" rx="2.5" ry="4"/></g>
          <g className="face closed" stroke="#17151d" strokeWidth="3.5" strokeLinecap="round"><path d="M86 43q5-6 10 0m19 0q5-6 10 0"/></g>
          <g className="face shy" stroke="#17151d" strokeWidth="3.5" strokeLinecap="round"><path d="M86 43q5-6 10 0m19 0q5-6 10 0M100 64q6-8 13 0"/></g>
        </g>
        <g className="character black">
          <rect x="133" y="54" width="58" height="129" rx="9" fill="#141516"/>
          <g className="face open"><ellipse cx="151" cy="88" rx="7" ry="8" fill="white"/><ellipse cx="174" cy="88" rx="7" ry="8" fill="white"/><g className="eye-look" fill="#141516"><ellipse cx="152" cy="88" rx="3.6" ry="4.4"/><ellipse cx="175" cy="88" rx="3.6" ry="4.4"/></g></g>
          <g className="face closed" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M145 89q6 6 12 0m10 0q6 6 12 0"/></g>
        </g>
        <g className="character yellow">
          <path d="M178 183v-66a35 35 0 0 1 70 0v66z" fill="#93b4ff"/>
          <g className="face open"><g className="eye-look"><circle cx="229" cy="121" r="3" fill="#17151d"/></g><path d="M218 145h38" stroke="#17151d" strokeWidth="3.5" strokeLinecap="round"/></g>
          <g className="face closed" stroke="#17151d" strokeWidth="3.5" strokeLinecap="round"><path d="M195 115q4-5 8 0"/></g>
          <g className="face shy" stroke="#17151d" strokeWidth="3.5" strokeLinecap="round"><path d="M195 115q4-5 8 0M178 144q5-6 11 0t11 0t11 0"/></g>
        </g>
        <g className="character orange">
          <path d="M0 183a85 85 0 0 1 170 0z" fill="#3b82f6"/>
          <g className="face open" fill="#17151d"><g className="eye-look"><circle cx="63" cy="144" r="4"/><circle cx="105" cy="144" r="4"/></g><path d="M71 157q13 17 27 0z"/></g>
          <g className="face closed" stroke="#17151d" strokeWidth="3.5" strokeLinecap="round"><path d="M55 145q7-8 14 0m28 0q7-8 14 0"/></g>
          <g className="face shy" stroke="#17151d" strokeWidth="3.5" strokeLinecap="round"><path d="M55 145q7-8 14 0m28 0q7-8 14 0M73 166q13-13 26 0"/></g>
        </g>
      </svg>
        </div>
        <div className="form-side">
          <header className="intro">
            <img className="talio-mark" src="/logo.png" alt="Talio" />
            <h1>Welcome back</h1>
            <p className="subtitle">Sign in to your Talio workspace.</p>
          </header>
          <form onSubmit={handleSubmit} aria-busy={loading} onFocus={mood} onBlur={() => { card.current.dataset.mood = showPassword ? 'revealed' : 'neutral' }}>
            <label className="field" htmlFor="email"><span className="field-label">Email address</span><span className="input-wrap"><input id="email" name="email" type="email" placeholder="name@company.com" autoComplete="username" spellCheck={false} required value={formData.email} onChange={handleChange} disabled={loading} /></span></label>
            <div className="field">
              <label className="field-label" htmlFor="password">Password</label>
              <div className="input-wrap password-wrap">
                <input id="password" name="password" type={showPassword ? 'text' : 'password'} placeholder="Enter your password" autoComplete="current-password" required value={formData.password} onChange={handleChange} disabled={loading} />
                <button className="reveal" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} aria-controls="password" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <FaEyeSlash /> : <FaEye />}</button>
              </div>
            </div>
            <div className="options"><label className="remember"><input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} /><span>Remember my email</span></label></div>
            <button className="login" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="divider">Need a hand?</div>
          <Link className="recovery" href="/auth/forgot-password">Forgot password?</Link>
          <p className="signup">Need access? Contact your administrator.</p>
        </div>
      </div>
    </main>
  )
}
