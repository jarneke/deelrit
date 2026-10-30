"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import AppIcon, { type IconName } from "./app-icon";
import { GlassButton } from "./glass-surface";
import styles from "./action-button.module.css";

type ButtonVariant = "primary" | "secondary" | "glass" | "ghost";

type BaseProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  loading?: boolean;
  danger?: boolean;
  variant?: ButtonVariant;
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
  variant,
  className,
  disabled,
  title,
  type = "button",
  ...props
}: Props) {
  const classes = [
    styles.button,
    variant && styles.styled,
    variant && styles[variant],
    iconOnly && styles.iconOnly,
    danger && styles.danger,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const buttonProps: ButtonHTMLAttributes<HTMLButtonElement> = {
    ...props,
    type,
    className: classes,
    disabled: disabled || loading,
    "aria-label": iconOnly ? label : props["aria-label"],
    "aria-busy": loading ? true : props["aria-busy"],
    title: iconOnly ? label : title,
  };

  const content = (
    <>
      <AppIcon
        name={loading ? "loader" : icon}
        className={loading ? styles.spinning : undefined}
      />

      {!iconOnly && children}
    </>
  );

  if (variant === "glass") {
    return <GlassButton {...buttonProps}>{content}</GlassButton>;
  }

  return <button {...buttonProps}>{content}</button>;
}

export function ActionGroup({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}
