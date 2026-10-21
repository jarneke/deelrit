import styles from "./loading-state.module.css";

type Props = {
  title?: string;
  description?: string;
};

export default function LoadingState({
  title = "Deelrit laden…",
  description = "Even geduld, we halen je gegevens op.",
}: Props) {
  return (
    <div className={styles.screen}>
      <div
        className={styles.card}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={styles.logo} aria-hidden="true">
          deel<span>rit.</span>
        </span>

        <div className={styles.indicator} aria-hidden="true">
          <svg
            className={styles.car}
            viewBox="0 0 48 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m10 13 4-8h20l4 8M7 13h34v12H7zM17 5v8m14-8v8M7 19h5m24 0h5" />
            <circle cx="15" cy="25" r="4" />
            <circle cx="33" cy="25" r="4" />
          </svg>

          <span className={styles.track}>
            <span />
          </span>
        </div>

        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
    </div>
  );
}
