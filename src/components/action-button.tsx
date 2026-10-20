"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import AppIcon, { type IconName } from "./app-icon";
import styles from "./action-button.module.css";

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  loading?: boolean;
  danger?: boolean;
};

type Props = BaseProps &
  (
    | {
        iconOnly: true;
        label: string;
        children?: never;
      }
    | {
        iconOnly?: false;
        label?: string;
        children: ReactNode;
      }
  );

export default function ActionButton({
  icon,
  iconOnly = false,
  label,
  children,
  loading = false,
  danger = false,
  className,
  disabled,
  title,
  type = "button",
  ...props
}: Props) {
  const classes = [
    styles.button,
    className,
    iconOnly && styles.iconOnly,
    danger && styles.danger,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...props}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-label={iconOnly ? label : props["aria-label"]}
      aria-busy={loading ? true : props["aria-busy"]}
      title={iconOnly ? label : title}
    >
      <AppIcon
        name={loading ? "loader" : icon}
        className={loading ? styles.spinning : undefined}
      />

      {!iconOnly && children}
    </button>
  );
}

export function ActionGroup({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}
