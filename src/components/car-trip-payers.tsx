"use client";

import { useId } from "react";
import {
  MAX_GUEST_NAME_LENGTH,
  MAX_TRIP_PAYERS,
  type TripPayer,
  type TripPayerInput,
} from "@/lib/car-trip-payers";
import ActionButton from "./action-button";
import styles from "./car-trip-payers.module.css";

type Member = {
  userId: string;
  name: string;
};

type Props = {
  members: Member[];
  currentUserId: string;
  previousPayers: TripPayer[];
  value: TripPayerInput[];
  onChange: (payers: TripPayerInput[]) => void;
};

const shareLabels = ["", "100%", "50%", "1/3", "25%", "20%"];

export default function CarTripPayers({
  members,
  currentUserId,
  previousPayers,
  value,
  onChange,
}: Props) {
  const id = useId();

  const options = members.map((member) => ({
    ...member,
    former: false,
  }));

  for (const payer of previousPayers) {
    if (
      payer.kind === "member" &&
      !options.some((option) => option.userId === payer.userId)
    ) {
      options.push({
        userId: payer.userId,
        name: payer.name,
        former: true,
      });
    }
  }

  function selectedElsewhere(userId: string, index: number) {
    return value.some(
      (payer, payerIndex) =>
        payerIndex !== index &&
        payer.kind === "member" &&
        payer.userId === userId,
    );
  }

  function replacePayer(index: number, payer: TripPayerInput) {
    onChange(
      value.map((existing, payerIndex) =>
        payerIndex === index ? payer : existing,
      ),
    );
  }

  function addPayer() {
    if (value.length >= MAX_TRIP_PAYERS) return;

    const member = members.find(
      (candidate) =>
        !value.some(
          (payer) =>
            payer.kind === "member" && payer.userId === candidate.userId,
        ),
    );

    const payer: TripPayerInput = member
      ? {
          kind: "member",
          userId: member.userId,
        }
      : {
          kind: "guest",
          name: "",
        };

    onChange([...value, payer]);
  }

  function changeKind(index: number, isGuest: boolean) {
    if (isGuest) {
      replacePayer(index, {
        kind: "guest",
        name: "",
      });

      return;
    }

    const member = members.find(
      (candidate) => !selectedElsewhere(candidate.userId, index),
    );

    replacePayer(index, {
      kind: "member",
      userId: member?.userId ?? "",
    });
  }

  return (
    <div
      className={styles.editor}
      role="group"
      aria-labelledby={`${id}-heading`}
      aria-describedby={`${id}-explanation`}
    >
      <div className={styles.header}>
        <div>
          <h3 id={`${id}-heading`} className={styles.heading}>
            Wie betaalt?
          </h3>

          <p className={styles.count}>
            {value.length} van maximaal {MAX_TRIP_PAYERS} personen
          </p>
        </div>

        <ActionButton
          icon="plus"
          className={styles.add}
          disabled={value.length >= MAX_TRIP_PAYERS}
          onClick={addPayer}
        >
          Kost splitsen
        </ActionButton>
      </div>

      <div className={styles.list}>
        {value.map((payer, index) => {
          const controlId = `${id}-payer-${index}`;
          const guestCheckboxId = `${id}-guest-${index}`;

          return (
            <div className={styles.row} key={index}>
              <span className={styles.number} aria-hidden="true">
                {index + 1}
              </span>

              <div className={styles.fields}>
                <label htmlFor={controlId} className={styles.label}>
                  {payer.kind === "guest"
                    ? `Naam gast ${index + 1}`
                    : `Betaler ${index + 1}`}
                </label>

                {payer.kind === "guest" ? (
                  <input
                    id={controlId}
                    className={styles.control}
                    value={payer.name}
                    onChange={(event) =>
                      replacePayer(index, {
                        ...payer,
                        name: event.target.value,
                      })
                    }
                    placeholder="Naam van de gast"
                    maxLength={MAX_GUEST_NAME_LENGTH}
                    autoComplete="off"
                    required
                  />
                ) : (
                  <select
                    id={controlId}
                    className={styles.control}
                    value={payer.userId}
                    onChange={(event) =>
                      replacePayer(index, {
                        kind: "member",
                        userId: event.target.value,
                      })
                    }
                    required
                  >
                    <option value="" disabled>
                      Kies een groepslid
                    </option>

                    {options.map((member) => (
                      <option
                        key={member.userId}
                        value={member.userId}
                        disabled={selectedElsewhere(member.userId, index)}
                      >
                        {member.name}
                        {member.userId === currentUserId ? " · jij" : ""}
                        {member.former ? " · geen groepslid meer" : ""}
                      </option>
                    ))}
                  </select>
                )}

                <label htmlFor={guestCheckboxId} className={styles.guestToggle}>
                  <input
                    id={guestCheckboxId}
                    type="checkbox"
                    checked={payer.kind === "guest"}
                    onChange={(event) =>
                      changeKind(index, event.target.checked)
                    }
                  />
                  Gast gebruiker zonder account
                </label>
              </div>

              <div className={styles.actions}>
                <span className={styles.share}>
                  {shareLabels[value.length]}
                </span>

                {value.length > 1 && (
                  <ActionButton
                    icon="close"
                    iconOnly
                    label={`Betaler ${index + 1} verwijderen`}
                    className={styles.remove}
                    onClick={() =>
                      onChange(
                        value.filter((_, payerIndex) => payerIndex !== index),
                      )
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p
        id={`${id}-explanation`}
        className={styles.explanation}
        aria-live="polite"
      >
        {value.length === 1
          ? "Deze persoon betaalt de volledige kost van de rit."
          : `De kost wordt gelijk verdeeld: iedereen betaalt 1/${value.length} van de ritkost.`}
      </p>
    </div>
  );
}
