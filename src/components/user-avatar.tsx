"use client";

import Image from "next/image";
import { useState } from "react";

type Props = {
  name: string;
  source?: string | null;
  userId?: string | null;
};

export default function UserAvatar({ name, source, userId }: Props) {
  const resolvedSource =
    source !== undefined
      ? source
      : userId
        ? `/api/users/${encodeURIComponent(userId)}/photo`
        : null;

  const [failedSource, setFailedSource] = useState<string | null>(null);

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?";

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        width: "100%",
        height: "100%",
        minWidth: 0,
        overflow: "hidden",
        borderRadius: "inherit",
      }}
    >
      {resolvedSource && resolvedSource !== failedSource ? (
        <Image
          key={resolvedSource}
          src={resolvedSource}
          alt=""
          fill
          sizes="64px"
          unoptimized
          style={{ objectFit: "cover" }}
          onError={() => setFailedSource(resolvedSource)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
