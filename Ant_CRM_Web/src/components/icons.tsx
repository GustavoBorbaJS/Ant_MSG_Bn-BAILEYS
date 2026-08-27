// Icones de linha minimalistas (sem dependencia externa) usados no menu
// lateral e no dashboard. Todos aceitam className pra herdar cor/tamanho do
// contexto (ex: "h-5 w-5 text-current").
type IconProps = { className?: string };

const base = {
  fill: 'none' as const,
  viewBox: '0 0 24 24',
  strokeWidth: 1.8,
  stroke: 'currentColor',
};

export function DashboardIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 13h4V4H4v9zM4 20h4v-4H4v4zM10 20h10V11H10v9zM10 4v4h10V4H10z" />
    </svg>
  );
}

export function InstancesIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 18.5h2" />
    </svg>
  );
}

export function ContactsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="8" r="3.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 20c.7-3.6 3-5.5 5.5-5.5s4.8 1.9 5.5 5.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 4.3c1.5.4 2.6 1.8 2.6 3.4 0 1.6-1.1 3-2.6 3.4M18 14.7c2 .5 3.5 2.2 4 5.3" />
    </svg>
  );
}

export function CampaignsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.5 3 2.5 10.7l6.4 2.5M21.5 3l-3.4 17-6.3-6.9M21.5 3 8.9 13.2m0 0v6.3l3-3.5" />
    </svg>
  );
}

export function HistoryIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function ActivityIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12h4l2.2-6.5L13 18l2.4-6h6.1" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8.5" cy="8" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.8 19.5c.6-3.3 2.8-5 5.7-5s5.1 1.7 5.7 5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 4.3c1.4.4 2.4 1.7 2.4 3.2s-1 2.8-2.4 3.2M17.3 14.6c1.9.5 3.3 2 3.9 4.9" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.5a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9c.75.66 1.63 1.17 2.6 1.5l.5 2.5h4l.5-2.5a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5Z"
      />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 16.5 21 12l-5-4.5M21 12H9" />
    </svg>
  );
}

export function CameraIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1-2h7l1 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z"
      />
      <circle cx="12" cy="12.5" r="3.3" />
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function SendIcon({ className }: IconProps) {
  return <CampaignsIcon className={className} />;
}

export function TrendUpIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5 9.5 10l4 4L21 6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 6.5H21v5.5" />
    </svg>
  );
}

export function PercentIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.3" />
      <circle cx="17" cy="17" r="2.3" />
    </svg>
  );
}

export function InstallIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2" />
    </svg>
  );
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0-12 3.5 3.5M12 3 8.5 6.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 11v7.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V11" />
    </svg>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 9 4.7-9 4.7-9-4.7L12 3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m3 12.3 9 4.7 9-4.7M3 16.7l9 4.7 9-4.7" />
    </svg>
  );
}
