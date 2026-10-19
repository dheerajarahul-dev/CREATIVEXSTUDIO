"use client";

import { FormEvent, useState } from "react";

type Props = { workspaceId: string };

export default function InviteForm({ workspaceId }: Props) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    setFailed(false);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/studio/invitations?workspace=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), role: form.get("role") }),
      });
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Invitation request failed");
      setFeedback(result.message ?? "Invitation requested.");
      event.currentTarget.reset();
    } catch (error) {
      setFailed(true);
      setFeedback(error instanceof Error ? error.message : "Invitation request failed");
    } finally {
      setBusy(false);
    }
  }

  return <form className="secure-invite-form" onSubmit={submit}><label>Email address<input name="email" type="email" maxLength={254} autoComplete="off" required /></label><label>Role<select name="role"><option value="agency_manager">Agency manager</option><option value="video_editor">Video editor</option><option value="client">Client</option><option value="external_reviewer">External reviewer</option></select></label><button className="button button-primary" disabled={busy}>{busy ? "Requesting…" : "Send invitation"}</button>{feedback && <p className={failed ? "form-error" : "secure-success"} role="status">{feedback}</p>}</form>;
}
