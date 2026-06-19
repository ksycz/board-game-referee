type IconProps = {
  className?: string;
};

function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconScales({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 3v18" />
      <path d="M5 7h14" />
      <path d="M5 7 3 13h4L5 7Z" />
      <path d="M19 7l-2 6h4l-2-6Z" />
      <path d="M8 21h8" />
    </Icon>
  );
}

export function IconBook({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16.5H6.5A2.5 2.5 0 0 0 4 22V5.5Z" />
      <path d="M6.5 3A2.5 2.5 0 0 0 4 5.5V22" />
    </Icon>
  );
}

export function IconLibrary({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 12.5A2.5 2.5 0 0 1 6.5 10H20" />
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18.5H6.5A2.5 2.5 0 0 0 4 24V5.5Z" />
    </Icon>
  );
}

export function IconUpload({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 20h16" />
    </Icon>
  );
}
