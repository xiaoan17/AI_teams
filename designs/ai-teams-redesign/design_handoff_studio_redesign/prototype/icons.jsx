// Clean line icons for the Studio system. Stroke-based, 1.6px, currentColor.
// Exported to window at the end so other Babel scripts can use them.

function Ico({ d, size = 16, fill = "none", sw = 1.6, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" {...rest}>
      {d ? <path d={d} /> : children}
    </svg>
  );
}

const IconTerminal   = (p) => <Ico {...p}><polyline points="5 8 9 12 5 16" /><line x1="12" y1="16" x2="18" y2="16" /></Ico>;
const IconGrid       = (p) => <Ico {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Ico>;
const IconGauge      = (p) => <Ico {...p}><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /><path d="m13.5 10.5 3-3" /><path d="M3.5 18a9 9 0 1 1 17 0" /></Ico>;
const IconSettings   = (p) => <Ico {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></Ico>;
const IconChevL      = (p) => <Ico {...p}><polyline points="15 18 9 12 15 6" /></Ico>;
const IconChevR      = (p) => <Ico {...p}><polyline points="9 18 15 12 9 6" /></Ico>;
const IconChevDown   = (p) => <Ico {...p} sw={2}><polyline points="6 9 12 15 18 9" /></Ico>;
const IconPlay       = (p) => <Ico {...p} fill="currentColor" sw={0}><polygon points="6 4 20 12 6 20 6 4" /></Ico>;
const IconStopAll    = (p) => <Ico {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Ico>;
const IconClose      = (p) => <Ico {...p} sw={2}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></Ico>;
const IconMinus      = (p) => <Ico {...p} sw={2}><line x1="6" y1="12" x2="18" y2="12" /></Ico>;
const IconSearch     = (p) => <Ico {...p}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Ico>;
const IconPaperclip  = (p) => <Ico {...p}><path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Ico>;
const IconSend       = (p) => <Ico {...p} sw={1.8}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" /></Ico>;
const IconAt         = (p) => <Ico {...p}><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" /></Ico>;
const IconFolder     = (p) => <Ico {...p}><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></Ico>;
const IconFile       = (p) => <Ico {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /></Ico>;
const IconStar       = ({ filled, ...p }) => <Ico {...p} fill={filled ? "currentColor" : "none"}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Ico>;
const IconBolt       = (p) => <Ico {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Ico>;
const IconClock      = (p) => <Ico {...p}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></Ico>;
const IconUsers      = (p) => <Ico {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Ico>;
const IconArrowRight = (p) => <Ico {...p}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></Ico>;
const IconAlert      = (p) => <Ico {...p}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></Ico>;
const IconCheck      = (p) => <Ico {...p}><polyline points="20 6 9 17 4 12" /></Ico>;
const IconMsg        = (p) => <Ico {...p}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" /></Ico>;
const IconExpand     = (p) => <Ico {...p}><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></Ico>;
const IconSun        = (p) => <Ico {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Ico>;
const IconMoon       = (p) => <Ico {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></Ico>;

Object.assign(window, {
  IconTerminal, IconGrid, IconGauge, IconSettings, IconChevL, IconChevR, IconChevDown,
  IconPlay, IconStopAll, IconClose, IconMinus, IconSearch, IconPaperclip, IconSend,
  IconAt, IconFolder, IconFile, IconStar, IconBolt, IconClock, IconUsers, IconArrowRight,
  IconAlert, IconCheck, IconMsg, IconExpand, IconSun, IconMoon
});
