import type { ReactNode } from "react";

export type IconName =
  | "plus"
  | "edit"
  | "trash"
  | "save"
  | "close"
  | "arrow-left"
  | "arrow-right"
  | "check"
  | "loader";

const shapes: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,

  edit: (
    <>
      <path d="m16 3 5 5-12 12-6 1 1-6Z" />
      <path d="m14 5 5 5" />
    </>
  ),

  trash: (
    <>
      <path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15" />
      <path d="M10 10v7M14 10v7" />
    </>
  ),

  save: (
    <>
      <path d="M5 3h12l4 4v14H3V3Z" />
      <path d="M7 3v6h9V3M7 21v-8h10v8" />
    </>
  ),

  close: <path d="m6 6 12 12M18 6 6 18" />,

  "arrow-left": <path d="m12 5-7 7 7 7M5 12h14" />,

  "arrow-right": <path d="m12 5 7 7-7 7M5 12h14" />,

  check: <path d="m5 12 4 4L19 6" />,

  loader: <path d="M21 12a9 9 0 1 1-6.2-8.56" />,
};

type Props = {
  name: IconName;
  size?: number;
  className?: string;
};

export default function AppIcon({ name, size = 20, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}
