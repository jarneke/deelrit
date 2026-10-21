"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { manageGroupMember } from "@/actions/group-members";
import ActionButton from "./action-button";
import styles from "./group-members.module.css";

type Member = {
  id: string;
  userId: string;
  name: string;
  role: string;
};

type Props = {
  organizationId: string;
  currentUserId: string;
  members: Member[];
};

type Action = "promote" | "demote" | "remove";
type Selection = { member: Member; action: Action };

function isOwner(role: string) {
  return role.split(",").some((value) => value.trim() === "owner");
}

function roleLabel(role: string) {
  if (isOwner(role)) return "Eigenaar";
  if (role.split(",").some((value) => value.trim() === "admin")) {
    return "Beheerder";
  }
  return "Lid";
}

export default function GroupMembers({
  organizationId,
  currentUserId,
  members,
}: Props) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const currentMember = members.find(
    (member) => member.userId === currentUserId,
  );
  const canManage = Boolean(currentMember && isOwner(currentMember.role));
  const ownerCount = members.filter((member) => isOwner(member.role)).length;

  function select(member: Member, action: Action) {
    if (busy) return;
    setSelection({ member, action });
    setError("");
    setNotice("");
  }

  async function confirm() {
    if (!selection || busy) return;

    setBusy(true);
    setError("");

    try {
      const result = await manageGroupMember(
        organizationId,
        selection.member.id,
        selection.action,
      );

      if (!result.success) {
        setError(result.error);
        return;
      }

      if (result.removedSelf) {
        router.replace("/");
        router.refresh();
        return;
      }

      const name = selection.member.name;
      setNotice(
        selection.action === "promote"
          ? `${name} is nu co-eigenaar.`
          : selection.action === "demote"
            ? `${name} is nu lid.`
            : `${name} is uit de groep verwijderd.`,
      );
      setSelection(null);
      router.refresh();
    } catch {
      setError("De wijziging is niet gelukt. Probeer opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  function confirmationTitle() {
    if (!selection) return "";
    if (selection.action === "promote") return "Co-eigenaar maken?";
    if (selection.action === "demote") return "Terugzetten naar lid?";
    return selection.member.userId === currentUserId
      ? "Deze groep verlaten?"
      : "Lid verwijderen?";
  }

  function confirmationDescription() {
    if (!selection) return "";
    const name = selection.member.name;

    if (selection.action === "promote") {
      return `${name} krijgt dezelfde beheerdersrechten als jij en kan leden, eigenaars en uitnodigingen beheren.`;
    }

    if (selection.action === "demote") {
      return `${name} blijft lid, maar kan de groep en haar leden niet meer beheren.`;
    }

    return selection.member.userId === currentUserId
      ? "Je verliest toegang tot deze auto. Je eerdere registraties blijven bewaard."
      : `${name} verliest toegang tot deze auto. Eerdere registraties blijven bewaard.`;
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <h2>Wie deelt deze auto?</h2>
        <span className={styles.badge}>
          {members.length === 1 ? "1 lid" : `${members.length} leden`}
        </span>
      </div>

      <ul className={styles.list}>
        {members.map((member) => {
          const owner = isOwner(member.role);
          const onlyOwner = owner && ownerCount === 1;
          const self = member.userId === currentUserId;

          return (
            <li key={member.id} className={styles.member}>
              <div className={styles.identity}>
                <span className={styles.avatar} aria-hidden="true">
                  {member.name.trim().charAt(0).toUpperCase() || "?"}
                </span>

                <div className={styles.memberInfo}>
                  <p className={styles.name}>
                    {member.name}
                    {self ? " · jij" : ""}
                  </p>
                  <p className={styles.role}>
                    {roleLabel(member.role)}
                    {onlyOwner ? " · enige eigenaar" : ""}
                  </p>
                </div>
              </div>

              {canManage && !onlyOwner && (
                <div className={styles.actions}>
                  <ActionButton
                    icon={owner ? "user" : "shield"}
                    className={styles.secondary}
                    disabled={busy}
                    onClick={() => select(member, owner ? "demote" : "promote")}
                    aria-label={
                      owner
                        ? `${member.name} terugzetten naar lid`
                        : `${member.name} co-eigenaar maken`
                    }
                  >
                    {owner ? "Maak lid" : "Maak co-eigenaar"}
                  </ActionButton>

                  <ActionButton
                    icon={self ? "logout" : "trash"}
                    iconOnly
                    danger
                    className={styles.remove}
                    disabled={busy}
                    onClick={() => select(member, "remove")}
                    label={
                      self ? "Groep verlaten" : `${member.name} verwijderen`
                    }
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {selection && (
        <div
          className={styles.confirmation}
          role="region"
          aria-labelledby="member-confirmation-title"
        >
          <h3 id="member-confirmation-title">{confirmationTitle()}</h3>
          <p>{confirmationDescription()}</p>

          <div className={styles.actions}>
            <ActionButton
              icon={selection.action === "remove" ? "trash" : "check"}
              loading={busy}
              className={
                selection.action === "remove" ? styles.danger : styles.primary
              }
              onClick={confirm}
            >
              {busy ? "Opslaan…" : "Bevestigen"}
            </ActionButton>

            <ActionButton
              icon="close"
              className={styles.secondary}
              disabled={busy}
              onClick={() => {
                setSelection(null);
                setError("");
              }}
            >
              Annuleren
            </ActionButton>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
    </section>
  );
}
