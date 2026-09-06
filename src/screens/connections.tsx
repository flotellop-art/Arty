import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useConnectionsStatus } from '../hooks/useConnectionsStatus'
import type { ConnectionState } from '../services/connectionsStatus'

const button = 'min-h-11 border border-theme-border px-4 py-2 text-sm text-theme-ink hover:border-theme-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-theme-accent disabled:opacity-50'
const card = 'min-w-0 border border-theme-border p-5 space-y-3'
const providers = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini', mistral: 'Mistral' }
interface ConnectionsScreenProps {
  onBack: () => void; onAccess: () => void; onAgenda: () => void;
  onApiKeys: () => void; onMail: () => void;
  configurationOpen: boolean; onCloseConfiguration: () => void;
  navigationKey?: string; onMenuToggle?: () => void; menuOpen?: boolean; demo?: boolean;
}

export function ConnectionsScreen({ onBack, onAccess, onAgenda, onApiKeys, onMail, configurationOpen, onCloseConfiguration, navigationKey, onMenuToggle, menuOpen = false, demo = false }: ConnectionsScreenProps) {
  const { t } = useTranslation(), status = useConnectionsStatus(!demo), heading = useRef<HTMLHeadingElement>(null)
  const closeRef = useRef(onCloseConfiguration); closeRef.current = onCloseConfiguration
  const configurationRef = useRef(configurationOpen); configurationRef.current = configurationOpen
  useEffect(() => {
    // Let Settings/drawer restore their old focus first, then focus this page.
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      if (!configurationRef.current && !document.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) heading.current?.focus()
    }) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [navigationKey])
  useEffect(() => () => closeRef.current(), [])
  const value = demo ? null : status.snapshot
  const disabled = configurationOpen || status.state !== 'ready'
  const configureDisabled = disabled || !!value?.demo
  const badge = (state: ConnectionState) => <span className="inline-block border border-theme-border px-2 py-1 text-xs text-theme-muted">{t(`connections.state.${state}`)}</span>
  return <section className="h-full overflow-y-auto px-4 py-6 sm:px-8" aria-labelledby="connections-heading">
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <div className="flex flex-wrap gap-2">
        {onMenuToggle && <button id="arty-menu-button" className={`${button} min-[900px]:hidden`} onClick={onMenuToggle} aria-label={t('sidebar.navigation')} aria-expanded={menuOpen} aria-controls="arty-sidebar" disabled={configurationOpen}>☰</button>}
        <button className={button} onClick={onBack} disabled={configurationOpen}>← {t('connections.back')}</button>
      </div>
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-widest text-theme-muted">{t('connections.kicker')} · {t(`connections.platform.${status.platform}`)}</p>
        <h1 ref={heading} id="connections-heading" tabIndex={-1} className="font-display text-4xl outline-none">{t('connections.title')}</h1>
        <p className="text-theme-muted">{t('connections.intro')}</p>
        <p className="border-l-2 border-theme-accent pl-4 text-sm text-theme-muted">{t('connections.localOnly')}</p>
      </header>
      {!demo && status.state !== 'ready' && <div role="status" className={card}>
        <p>{t(status.state === 'loading' ? 'connections.reading' : 'connections.unavailable')}</p>
        {status.state === 'unavailable' && <button className={button} onClick={() => { void status.refresh() }} disabled={configurationOpen}>{t('connections.retry')}</button>}
      </div>}
      {(demo || value?.demo) && <p role="status" className="text-sm text-theme-muted">{t('connections.demo')}</p>}
      {value && <div className="grid gap-4 md:grid-cols-2">
        <article className={card} aria-labelledby="connection-session">
          <h2 id="connection-session" className="font-display text-2xl">{t('connections.session.title')}</h2>
          <p className="text-sm">{t(`connections.session.${value.session}`)}</p>
          <p className="text-sm text-theme-muted">{t('connections.session.description')}</p>
          <button className={button} disabled={disabled} onClick={() => status.act(onAccess)}>{t('connections.session.action')}</button>
        </article>
        <article className={card} aria-labelledby="connection-google">
          <h2 id="connection-google" className="font-display text-2xl">{t('connections.google.title')}</h2>
          {badge(value.google)}
          <p className="text-sm text-theme-muted">{t('connections.google.description')}</p>
          {value.google === 'not-supported' ? <p className="text-sm text-theme-muted">{t('connections.google.unsupported')}</p> : <>
            <button className={button} disabled={configureDisabled} onClick={() => status.act(onAgenda)}>{t('connections.google.action')}</button>
            <p className="text-xs text-theme-muted">{t('connections.google.returnHint')}</p>
          </>}
        </article>
        <article className={card} aria-labelledby="connection-keys">
          <h2 id="connection-keys" className="font-display text-2xl">{t('connections.keys.title')}</h2>
          <p className="text-sm text-theme-muted">{t('connections.keys.description')}</p>
          <dl className="space-y-2">{value.keys.map(key => <div key={key.provider} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <dt>{providers[key.provider]}</dt><dd>{badge(key.state)}</dd>
          </div>)}</dl>
          <p className="text-xs text-theme-muted">{t('connections.keys.setupNote')}</p>
          <button className={button} disabled={configureDisabled} onClick={() => status.act(onApiKeys)}>{t('connections.keys.action')}</button>
        </article>
        <article className={card} aria-labelledby="connection-mail">
          <h2 id="connection-mail" className="font-display text-2xl">{t('connections.mail.title')}</h2>
          {badge(value.mail)}
          {value.mail === 'configured' && <p className="text-sm">{t('connections.mail.count', { count: value.mailCount })}</p>}
          <p className="text-sm text-theme-muted">{t('connections.mail.description')}</p>
          {value.mail === 'unknown' && <p className="text-sm text-theme-muted">{t('connections.mail.unknown')}</p>}
          {value.mail === 'not-supported' ? <p className="text-sm text-theme-muted">{t('connections.mail.unsupported')}</p>
            : <button className={button} disabled={configureDisabled} onClick={() => status.act(onMail)}>{t('connections.mail.action')}</button>}
        </article>
      </div>}
      <aside className={card}>
        <h2 className="font-display text-2xl">{t('connections.unsupported.title')}</h2>
        <p className="text-sm text-theme-muted">{t('connections.unsupported.description')}</p>
      </aside>
    </div>
  </section>
}
