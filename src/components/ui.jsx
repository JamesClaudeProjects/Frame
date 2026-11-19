import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY } from '../glossary.js';

/** useState that survives reloads (per browser). Storage can be unavailable — fall back silently. */
export function usePersist(key, init) {
  const [v, setV] = useState(() => {
    try {
      const s = window.localStorage.getItem('flatlay:' + key);
      return s == null ? init : JSON.parse(s);
    } catch { return init; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('flatlay:' + key, JSON.stringify(v)); } catch { /* private mode etc. */ }
  }, [key, v]);
  return [v, setV];
}

/**
 * Collapsible section. Closed, it shows a one-line summary so the user still sees the
 * headline number without the detail.
 */
export function Section({ id, title, summary, defaultOpen = true, children, className = '', aside }) {
  const [open, setOpen] = usePersist('sec:' + id, defaultOpen);
  const bodyId = useId();
  return (
    <section className={`sec ${open ? 'is-open' : ''} ${className}`}>
      <div className="sec-head">
        <button type="button" className="sec-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <span className="chev" aria-hidden="true" />
          <span className="sec-title">{title}</span>
          {!open && summary && <span className="sec-sum">{summary}</span>}
        </button>
        {aside && <div className="sec-aside">{aside}</div>}
      </div>
      {open && <div className="sec-body" id={bodyId}>{children}</div>}
    </section>
  );
}

/** Small "show more" disclosure for inline text. */
export function More({ children, label = 'more', lessLabel = 'less' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && children}
      <button type="button" className="more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? lessLabel : label}</button>
    </>
  );
}

/**
 * Hover / focus / tap tag. Wraps a term or value; the explanation comes from the glossary,
 * optionally followed by a line computed from the current scene (`extra`).
 * Rendered in a portal with fixed positioning so scrolling panels never clip it.
 */
export function Tip({ term, extra, children, className = '' }) {
  const g = GLOSSARY[term];
  const ref = useRef(null);
  const [anchor, setAnchor] = useState(null);
  const shownAt = useRef(0);
  const id = useId();
  if (!g && !extra) return children;
  const show = () => {
    shownAt.current = Date.now();
    const r = ref.current.getBoundingClientRect();
    setAnchor({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
  };
  const hide = () => setAnchor(null);
  return (
    <TipTrigger refEl={ref} open={!!anchor} onShow={show} onHide={hide} shownAt={shownAt} id={id} className={className} box={anchor && createPortal(<TipBox id={id} anchor={anchor} g={g} extra={extra} />, document.body)}>
      {children}
    </TipTrigger>
  );
}

// Hover is for real mouse pointers only; touch opens on tap and closes on a tap elsewhere.
function TipTrigger({ refEl, open, onShow, onHide, shownAt, id, className, box, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (refEl.current && !refEl.current.contains(e.target)) onHide(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, onHide, refEl]);
  return (
    <>
      <span
        ref={refEl}
        className={`tip ${className}`}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') onShow(); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') onHide(); }}
        onFocus={onShow}
        onBlur={onHide}
        // A tap fires focus (show) then click; only toggle on a deliberate later tap.
        onClick={(e) => { e.stopPropagation(); if (Date.now() - shownAt.current < 400) return; if (open) onHide(); else onShow(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') onHide(); }}
      >
        {children}
      </span>
      {box}
    </>
  );
}

function TipBox({ id, anchor, g, extra }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.x - w / 2, vw - w - 8));
    const above = anchor.top - h - 8;
    const top = above >= 8 ? above : Math.min(anchor.bottom + 8, vh - h - 8);
    setPos({ left, top });
  }, [anchor]);
  return (
    <div ref={ref} id={id} role="tooltip" className="tipbox" style={{ left: pos.left, top: pos.top }}>
      {g?.title && <div className="tip-title">{g.title}</div>}
      {g?.body && <div className="tip-body">{g.body}</div>}
      {extra && <div className="tip-extra">{extra}</div>}
    </div>
  );
}

/** A label with its glossary tag — the common "Term: value" pattern. */
export function Term({ term, children, extra }) {
  return <Tip term={term} extra={extra}>{children}</Tip>;
}
