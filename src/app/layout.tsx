import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deelrit",
  description: "Jullie gedeelde auto, kilometers en kosten op één plek.",
};

const themeScript = `
(function () {
  var root = document.documentElement;
  var themeKey = "deelrit-theme";
  var accentKey = "deelrit-accent";
  var preference = "system";
  var accent = "silver";
  var media = window.matchMedia("(prefers-color-scheme: dark)");

  var customProperties = [
    "--accent-base",
    "--accent-ink",
    "--accent-text-base",
    "--accent-hover",
    "--selection-border"
  ];

  function isPreference(value) {
    return value === "light" || value === "dark" || value === "system";
  }

  function normalizeAccent(value) {
    if (typeof value !== "string") {
      return null;
    }

    if (value === "silver") {
      return value;
    }

    if (/^#[0-9a-f]{6}$/i.test(value)) {
      return value.toLowerCase();
    }

    switch (value) {
      case "ice":
        return "#466ba8";
      case "blue":
        return "#335dcc";
      case "violet":
        return "#7548b3";
      case "rose":
        return "#ae4569";
      default:
        return null;
    }
  }

  function readPreference() {
    try {
      var saved = window.localStorage.getItem(themeKey);
      return isPreference(saved) ? saved : "system";
    } catch (_) {
      return "system";
    }
  }

  function readAccent() {
    try {
      return normalizeAccent(
        window.localStorage.getItem(accentKey)
      ) || "silver";
    } catch (_) {
      return "silver";
    }
  }

  function rgb(hex) {
    return [1, 3, 5].map(function (index) {
      return parseInt(hex.slice(index, index + 2), 16);
    });
  }

  function luminance(hex) {
    var channels = rgb(hex).map(function (value) {
      var channel = value / 255;

      return channel <= 0.04045
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

    return (
      channels[0] * 0.2126 +
      channels[1] * 0.7152 +
      channels[2] * 0.0722
    );
  }

  function contrast(first, second) {
    var a = luminance(first);
    var b = luminance(second);

    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function mix(first, second, amount) {
    var a = rgb(first);
    var b = rgb(second);

    return "#" + a.map(function (value, index) {
      return Math.round(
        value + (b[index] - value) * amount
      ).toString(16).padStart(2, "0");
    }).join("");
  }

  function readableAccent(color, dark) {
    var surface = dark ? "#1b1d22" : "#ffffff";

    var backgrounds = dark
      ? ["#111215", surface, "#22252b", "#2b2e36"]
      : ["#f5f6f8", surface, "#f0f1f4", "#e8eaee"];

    backgrounds.push(mix(surface, color, 0.16));

    var target = dark ? "#ffffff" : "#000000";

    for (var step = 0; step <= 100; step++) {
      var candidate = mix(color, target, step / 100);

      var readable = backgrounds.every(function (background) {
        return contrast(candidate, background) >= 4.5;
      });

      if (readable) {
        return candidate;
      }
    }

    return target;
  }

  function applyAccent(dark) {
    customProperties.forEach(function (property) {
      root.style.removeProperty(property);
    });

    root.setAttribute("data-accent", accent);

    if (accent === "silver") {
      return;
    }

    var ink =
      contrast(accent, "#ffffff") >= contrast(accent, "#000000")
        ? "#ffffff"
        : "#000000";

    var hover = mix(
      accent,
      ink === "#ffffff" ? "#000000" : "#ffffff",
      0.15
    );

    var text = readableAccent(accent, dark);

    root.style.setProperty("--accent-base", accent);
    root.style.setProperty("--accent-ink", ink);
    root.style.setProperty("--accent-text-base", text);
    root.style.setProperty("--accent-hover", hover);
    root.style.setProperty("--selection-border", text);
  }

  function applyAppearance() {
    var resolved =
      preference === "system"
        ? (media.matches ? "dark" : "light")
        : preference;

    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-theme-preference", preference);

    applyAccent(resolved === "dark");

    window.dispatchEvent(new Event("deelrit:theme-applied"));
  }

  preference = readPreference();
  accent = readAccent();
  applyAppearance();

  media.addEventListener("change", function () {
    if (preference === "system") {
      applyAppearance();
    }
  });

  window.addEventListener("deelrit:theme-change", function (event) {
    if (!isPreference(event.detail)) {
      return;
    }

    preference = event.detail;
    applyAppearance();
  });

  window.addEventListener("deelrit:accent-change", function (event) {
    var next = normalizeAccent(event.detail);

    if (next === null) {
      return;
    }

    accent = next;
    applyAppearance();
  });

  window.addEventListener("storage", function (event) {
    if (
      event.key !== themeKey &&
      event.key !== accentKey &&
      event.key !== null
    ) {
      return;
    }

    preference = readPreference();
    accent = readAccent();
    applyAppearance();
  });

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      preference = readPreference();
      accent = readAccent();
      applyAppearance();
    }
  });
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <head>
        <script
          id="deelrit-theme"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>

      <body>{children}</body>
    </html>
  );
}
