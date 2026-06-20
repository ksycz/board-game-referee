import type { ReactNode } from "react";

type IconProps = {
  className?: string;
};

type DieProps = IconProps & {
  pip?: "six";
  value?: number;
};

function Icon({ className, children }: IconProps & { children: ReactNode }) {
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

export function IconPin({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 17v5" />
      <path d="M5 7.5 6.5 3h11L19 7.5l-5.5 2.5V15l-1.5-1-1.5 1v-5L5 7.5Z" />
    </Icon>
  );
}

export function IconThumbUp({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.67 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </Icon>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </Icon>
  );
}

export function IconClose({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M6 6l12 12" />
      <path d="m18 6-12 12" />
    </Icon>
  );
}

export function IconCopy({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="9" y="9" width="11" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  );
}

export function IconShare({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 3v10" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </Icon>
  );
}

export function IconThumbDown({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.33 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </Icon>
  );
}

function DieFace({
  className,
  fill,
  stroke,
  children,
}: IconProps & { fill: string; stroke: string; children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="34" height="34" rx="8" fill={fill} stroke={stroke} strokeWidth="2" />
      <rect x="6" y="6" width="28" height="28" rx="6" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="1" />
      {children}
    </svg>
  );
}

function DiePip({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r="2.6" fill="rgb(255 255 255 / 0.92)" />;
}

export function DieD6({ className, pip = "six" }: DieProps) {
  const pips =
    pip === "six"
      ? [
          [12, 12],
          [28, 12],
          [12, 20],
          [28, 20],
          [12, 28],
          [28, 28],
        ]
      : [[20, 20]];

  return (
    <DieFace className={className} fill="#8c3a2e" stroke="#c97858">
      {pips.map(([cx, cy]) => (
        <DiePip key={`${cx}-${cy}`} cx={cx} cy={cy} />
      ))}
    </DieFace>
  );
}

export function DieD20({ className, value = 20 }: DieProps) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill="#8f5038" stroke="#c98872" strokeWidth="2" />
      <circle cx="20" cy="20" r="13" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="1" />
      <text
        x="20"
        y="24"
        textAnchor="middle"
        fontFamily="Syne, sans-serif"
        fontSize="11"
        fontWeight="800"
        fill="#1a1208"
      >
        {value}
      </text>
    </svg>
  );
}
