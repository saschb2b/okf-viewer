// Plan document intake: the inspectable mapping from picked documents to
// proposed concepts.
//
// Read-only toward the world, and deliberately so. Choosing documents runs
// the deterministic Rust planner; nothing here starts an agent, writes to a
// bundle, or fetches. The one thing the user can change is the keep/drop
// mark on each proposed concept, and the one thing they can do with the
// result is save it beside this bundle for a later rerun. See
// docs/features/document-intake.md.

import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import {
  planDocumentIntake,
  removeIntakePlan,
  saveIntakePlan,
  savedIntakePlans,
  type IntakePlan,
  type IntakePlanConcept,
  type SavedIntakePlan,
} from "@/shared/ipc.ts";
import "./IntakePlanDialog.css";

type SaveState = "unsaved" | "saving" | "saved";

export function IntakePlanDialog({
  open,
  root,
  onOpenChange,
}: {
  open: boolean;
  root: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [plan, setPlan] = useState<IntakePlan | null>(null);
  const [saved, setSaved] = useState<SavedIntakePlan[]>([]);
  const [picking, setPicking] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("unsaved");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !root) return;
    let ignore = false;
    void savedIntakePlans(root).then(
      (plans) => {
        if (!ignore) setSaved(plans);
      },
      () => {
        // A missing saved list is not worth blocking planning over; the
        // save action reports its own failures.
      },
    );
    return () => {
      ignore = true;
    };
  }, [open, root]);

  function choose() {
    if (picking) return;
    setPicking(true);
    setError(null);
    void planDocumentIntake()
      .then((next) => {
        // Null means the picker was cancelled; the previous plan stands.
        if (next) {
          setPlan(next);
          setSaveState("unsaved");
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The plan could not be computed.");
      })
      .finally(() => setPicking(false));
  }

  function toggle(conceptId: string) {
    if (!plan) return;
    setSaveState("unsaved");
    setPlan({
      ...plan,
      concepts: plan.concepts.map((concept) =>
        concept.id === conceptId ? { ...concept, included: !concept.included } : concept,
      ),
    });
  }

  function save() {
    if (!plan || !root || saveState === "saving") return;
    setSaveState("saving");
    setError(null);
    void saveIntakePlan(root, plan)
      .then((entry) => {
        setSaveState("saved");
        setSaved((current) => [
          entry,
          ...current.filter((existing) => existing.plan.planId !== entry.plan.planId),
        ]);
      })
      .catch((cause: unknown) => {
        setSaveState("unsaved");
        setError(cause instanceof Error ? cause.message : "The plan could not be saved.");
      });
  }

  function removeSaved(planId: string) {
    if (!root) return;
    void removeIntakePlan(root, planId)
      .then(() => {
        setSaved((current) => current.filter((entry) => entry.plan.planId !== planId));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "The plan could not be removed.");
      });
  }

  const included = plan?.concepts.filter((concept) => concept.included).length ?? 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-backdrop" />
        <Dialog.Popup className="ui-dialog intake-plan">
          <header className="intake-plan__header">
            <div>
              <Dialog.Title className="ui-dialog-title">Plan document intake</Dialog.Title>
              <p className="intake-plan__subtitle">
                How picked documents would become proposed concepts. Nothing runs or writes from
                here.
              </p>
            </div>
            <Dialog.Close className="btn ghost icon" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </header>

          {!root && <p className="intake-plan__note">Open a bundle to plan intake for it.</p>}

          {root && (
            <div className="intake-plan__actions">
              <button type="button" className="btn primary" disabled={picking} onClick={choose}>
                {picking ? "Planning…" : "Choose documents…"}
              </button>
              {plan && (
                <button
                  type="button"
                  className="btn"
                  disabled={saveState !== "unsaved"}
                  onClick={save}
                >
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save plan"}
                </button>
              )}
            </div>
          )}

          {error && (
            <p className="intake-plan__note intake-plan__note--error" role="alert">
              {error}
            </p>
          )}

          {root && !plan && saved.length > 0 && (
            <section className="intake-plan__section" aria-label="Saved plans">
              <h3 className="intake-plan__section-title">Saved plans</h3>
              <ul className="intake-plan__saved">
                {saved.map((entry) => (
                  <li key={entry.plan.planId} className="intake-plan__saved-row">
                    <span className="intake-plan__saved-name">
                      {entry.plan.sources.map((source) => source.title).join(", ")}
                    </span>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setPlan(entry.plan);
                        setSaveState("saved");
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => removeSaved(entry.plan.planId)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {root && !plan && saved.length === 0 && (
            <p className="intake-plan__note">
              Pick PDFs, Markdown, or other supported documents. Studio computes the plan locally;
              no agent or model is involved.
            </p>
          )}

          {plan && (
            <>
              <p className="intake-plan__summary" role="status">
                <strong>{included}</strong> of {plan.concepts.length} proposed concepts kept, from{" "}
                <strong>{plan.sources.length}</strong>{" "}
                {plan.sources.length === 1 ? "document" : "documents"}
              </p>

              <ul className="intake-plan__sources" aria-label="Planned sources">
                {plan.sources.map((source) => (
                  <li key={source.refreshFingerprint} className="intake-plan__source">
                    <span className="intake-plan__source-title">{source.title}</span>
                    <span className="intake-plan__source-meta">
                      {source.pageCount > 0 ? `${source.pageCount} pages` : source.mediaType}
                      {source.warningCodes.length > 0 && (
                        <span className="intake-plan__warning">
                          {" "}
                          · {source.warningCodes.join(", ")}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <section className="intake-plan__section" aria-label="Proposed concepts">
                <h3 className="intake-plan__section-title">Proposed concepts</h3>
                <ul className="intake-plan__concepts">
                  {plan.concepts.map((concept) => (
                    <li key={concept.id} className="intake-plan__concept">
                      <label className="intake-plan__keep">
                        <input
                          type="checkbox"
                          checked={concept.included}
                          onChange={() => toggle(concept.id)}
                        />
                        <span className="intake-plan__concept-title">{concept.title}</span>
                      </label>
                      <span className="intake-plan__span">{describeSpan(concept)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {plan.exclusions.length > 0 && (
                <section className="intake-plan__section" aria-label="Classified as furniture">
                  <h3 className="intake-plan__section-title">
                    Set aside as page furniture, not deleted
                  </h3>
                  <ul className="intake-plan__details">
                    {plan.exclusions.map((exclusion, index) => (
                      <li key={`${exclusion.sourceTitle}-${index}`}>
                        <code>{exclusion.text}</code> — {exclusion.reason}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan.evidence.length > 0 && (
                <section className="intake-plan__section" aria-label="Evidence candidates">
                  <h3 className="intake-plan__section-title">Evidence candidates, unverified</h3>
                  <ul className="intake-plan__details">
                    {plan.evidence.map((entry, index) => (
                      <li key={`${entry.sourceTitle}-${entry.marker}-${index}`}>
                        [{entry.marker}] {entry.text}
                        {entry.statedDate && ` (stated: ${entry.statedDate})`}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan.gaps.length > 0 && (
                <section className="intake-plan__section" aria-label="Named gaps">
                  <h3 className="intake-plan__section-title">Named gaps, no text recovered</h3>
                  <ul className="intake-plan__details">
                    {plan.gaps.map((gap, index) => (
                      <li key={`${gap.sourceTitle}-${index}`}>
                        {gap.caption} — page {gap.page}, {gap.kind} content is not extractable and
                        no text was invented for it
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan.omitted > 0 && (
                <p className="intake-plan__note">
                  {plan.omitted} structural item{plan.omitted === 1 ? "" : "s"} beyond the plan
                  limits {plan.omitted === 1 ? "was" : "were"} dropped from this view.
                </p>
              )}

              <p className="intake-plan__fingerprint">
                Plan <code>{plan.planId.slice(0, 12)}</code>, computed from the picked documents. A
                changed document produces a different plan.
              </p>
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function describeSpan(concept: IntakePlanConcept): string {
  if (concept.startPage === 0) return `${concept.sourceTitle} · whole document`;
  const from = `p. ${concept.startPage}`;
  const until = concept.untilPage > concept.startPage ? `–${concept.untilPage - 1}` : "";
  return `${concept.sourceTitle} · ${from}${until}`;
}
