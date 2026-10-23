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
  var storageKey = "deelrit-theme";
  var preference = "system";
  var media = window.matchMedia("(prefers-color-scheme: dark)");

  function isPreference(value) {
    return value === "light" || value === "dark" || value === "system";
  }

  function readPreference() {
    try {
      var saved = window.localStorage.getItem(storageKey);
      return isPreference(saved) ? saved : "system";
    } catch (_) {
      return "system";
    }
  }

  function applyTheme() {
    var resolved =
      preference === "system"
        ? (media.matches ? "dark" : "light")
        : preference;

    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-theme-preference", preference);

    window.dispatchEvent(new Event("deelrit:theme-applied"));
  }

  preference = readPreference();
  applyTheme();

  media.addEventListener("change", function () {
    if (preference === "system") {
      applyTheme();
    }
  });

  window.addEventListener("deelrit:theme-change", function (event) {
    if (!isPreference(event.detail)) {
      return;
    }

    preference = event.detail;
    applyTheme();
  });

  window.addEventListener("storage", function (event) {
    if (event.key !== storageKey && event.key !== null) {
      return;
    }

    preference = readPreference();
    applyTheme();
  });

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) {
      preference = readPreference();
      applyTheme();
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
