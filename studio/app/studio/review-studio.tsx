"use client";

import { useRef, useState, type FormEvent } from "react";
import { addReviewCommentAction, decideVideoVersionAction } from "./actions";

type ReviewComment = { id: string; body: string; time_seconds: number; created_at: string; author: string; resolved_at: string | null };
type Version = { id: string; status: string; label: string; version_number: number; notes: string; submitted_at: string | null };

type Props = { projectId: string; version: Version; videoUrl: string | null; comments: ReviewComment[]; canApprove: boolean };

function timecode(seconds: number) {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export default function ReviewStudio({ projectId, version, videoUrl, comments, canApprove }: Props) {
  const player = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [comment, setComment] = useState("");

  function submitComment(event: FormEvent<HTMLFormElement>) {
    if (!comment.trim()) event.preventDefault();
  }

  return <section className="review-studio">
    <div className="review-head"><div><span className="eyebrow">VIDEO REVIEW · V{String(version.version_number).padStart(2, "2")}</span><h3>{version.label}</h3><p>{version.notes || "Review the current cut and leave notes against the frame."}</p></div><span className={`review-state state-${version.status}`}>{version.status.replaceAll("_", " ")}</span></div>
    {videoUrl ? <div className="review-video-shell"><video ref={player} src={videoUrl} controls playsInline preload="metadata" onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}><track kind="captions" /></video></div> : <div className="review-video-empty"><span>▶</span><strong>Video preview unavailable</strong><small>The private file may still be processing, or its signed preview has expired. Refresh the project to request a fresh preview.</small></div>}
    <div className="review-workspace-grid"><div className="comment-column"><div className="review-subhead"><div><strong>Review notes</strong><small>{comments.length} notes · version-specific</small></div><span>{comments.filter((item) => !item.resolved_at).length} open</span></div><div className="review-comments">{comments.map((item) => <article className={`review-comment ${item.resolved_at ? "comment-resolved" : ""}`} key={item.id}><button className="comment-timestamp" onClick={() => { if (player.current) { player.current.currentTime = item.time_seconds; void player.current.play(); } }}>{timecode(item.time_seconds)} <span>↗</span></button><div><div className="comment-author"><strong>{item.author}</strong><small>{new Date(item.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></div><p>{item.body}</p>{item.resolved_at && <span className="resolved-label">Resolved</span>}</div></article>)}{comments.length === 0 && <div className="review-empty">No notes on this version yet. Add the first frame-specific note below.</div>}</div><form action={addReviewCommentAction} className="review-comment-form" onSubmit={submitComment}><input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="version_id" value={version.id} /><input type="hidden" name="time_seconds" value={currentTime.toFixed(3)} /><div className="comment-form-time">{timecode(currentTime)}<span>Current frame</span></div><textarea name="body" rows={2} maxLength={5000} required value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Describe what needs attention at this moment…" /><button className="button button-primary" type="submit">Add review note ↗</button></form></div>
    <aside className="review-sidebar"><div className="review-subhead"><div><strong>Version details</strong><small>Recorded submission</small></div></div><dl className="version-details"><div><dt>Version</dt><dd>V{String(version.version_number).padStart(2, "2")}</dd></div><div><dt>Status</dt><dd>{version.status.replaceAll("_", " ")}</dd></div><div><dt>Submitted</dt><dd>{version.submitted_at ? new Date(version.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Draft"}</dd></div></dl>{canApprove && ["submitted", "in_review", "resubmitted"].includes(version.status) && <form action={decideVideoVersionAction} className="approval-form"><input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="version_id" value={version.id} /><label>Decision note<textarea name="note" rows={3} maxLength={5000} placeholder="Optional context for the editor" /></label><button className="button button-primary" name="decision" value="approved">Approve this version</button><button className="button button-outline" name="decision" value="changes_requested">Request changes</button><small>Approval applies only to V{String(version.version_number).padStart(2, "2")}.</small></form>}{!canApprove && <div className="approval-note"><span>ⓘ</span><p>Client approval is enabled when this version is submitted for review.</p></div>}</aside></div>
  </section>;
}
