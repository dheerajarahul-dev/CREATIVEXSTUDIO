"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "tus-js-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type UploadCategory = "raw_video" | "work_in_progress" | "final_video" | "audio" | "image" | "document" | "subtitle" | "project_file" | "reference" | "misc";
type UploadJob = { id: string; name: string; progress: number; state: "uploading" | "complete" | "error"; message?: string };
type UploadGrant = { bucket: string; path: string; endpoint: string };

export default function AssetUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const uploads = useRef(new Map<string, Upload>());
  const [category, setCategory] = useState<UploadCategory>("work_in_progress");
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [busy, setBusy] = useState(false);

  function updateJob(id: string, update: Partial<UploadJob>) {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...update } : job));
  }

  async function uploadFile(file: File, token: string, key: string) {
    const response = await fetch("/api/studio/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: file.name, type: file.type, size: file.size, category }),
    });
    const grant = await response.json() as UploadGrant & { error?: string };
    if (!response.ok) throw new Error(grant.error ?? "Upload permission could not be confirmed");

    const upload = new Upload(file, {
      endpoint: grant.endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000],
      headers: { authorization: `Bearer ${token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
      metadata: { bucketName: grant.bucket, objectName: grant.path, contentType: file.type, cacheControl: "3600" },
      onProgress(bytesSent, bytesTotal) {
        updateJob(key, { progress: bytesTotal ? Math.round(bytesSent / bytesTotal * 100) : 0 });
      },
      onError(error) {
        uploads.current.delete(key);
        updateJob(key, { state: "error", message: error.message.slice(0, 180) });
        setBusy(false);
      },
      onSuccess() {
        void (async () => {
          const completion = await fetch("/api/studio/uploads/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, path: grant.path, name: file.name, type: file.type, size: file.size, category }),
          });
          const result = await completion.json() as { error?: string };
          if (!completion.ok) {
            updateJob(key, { state: "error", message: result.error ?? "Upload finished but its asset record could not be saved" });
          } else {
            updateJob(key, { state: "complete", progress: 100 });
            router.refresh();
          }
          uploads.current.delete(key);
          setBusy(uploads.current.size > 0);
        })().catch((error: unknown) => {
          updateJob(key, { state: "error", message: error instanceof Error ? error.message : "Upload could not be finalized" });
          uploads.current.delete(key);
          setBusy(false);
        });
      },
    });

    uploads.current.set(key, upload);
    const previous = await upload.findPreviousUploads();
    if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
    upload.start();
  }

  async function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    const keys = files.map(() => crypto.randomUUID());
    setJobs((current) => [...files.map((file, index) => ({ id: keys[index], name: file.name, progress: 0, state: "uploading" as const })), ...current].slice(0, 8));
    setBusy(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.access_token) throw new Error("Your session expired. Sign in again before uploading.");
      await Promise.all(files.map((file, index) => uploadFile(file, session.access_token, keys[index]).catch((error: unknown) => {
        updateJob(keys[index], { state: "error", message: error instanceof Error ? error.message : "Upload could not start" });
      })));
      setBusy(uploads.current.size > 0);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Upload could not start";
      keys.forEach((key) => updateJob(key, { state: "error", message: text }));
      setBusy(false);
    }
  }

  async function cancelUpload(id: string) {
    const upload = uploads.current.get(id);
    if (!upload) return;
    await upload.abort();
    uploads.current.delete(id);
    updateJob(id, { state: "error", message: "Upload paused. Choose the same file again to resume." });
    setBusy(uploads.current.size > 0);
  }

  return <div className="asset-uploader"><div className="asset-uploader-head"><div><strong>Add project files</strong><small>Private storage · Resumable 6 MB chunks</small></div><label className="upload-category">Category<select value={category} onChange={(event) => setCategory(event.target.value as UploadCategory)}><option value="raw_video">Raw footage</option><option value="work_in_progress">Work in progress</option><option value="final_video">Final video</option><option value="audio">Audio</option><option value="image">Image</option><option value="document">Document</option><option value="subtitle">Subtitle</option><option value="project_file">Project file</option><option value="reference">Reference</option><option value="misc">Other</option></select></label><label className={`upload-button ${busy ? "upload-busy" : ""}`}>＋ Choose files<input type="file" multiple accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,image/jpeg,image/png,image/webp,application/pdf,text/plain,.zip" onChange={selectFiles} disabled={busy} /></label></div>{jobs.length > 0 && <div className="upload-jobs">{jobs.slice(0, 4).map((job) => <div className="upload-job" key={job.id}><span className="upload-job-icon">{job.state === "complete" ? "✓" : job.state === "error" ? "!" : "↑"}</span><div className="upload-job-content"><div><strong>{job.name}</strong><small>{job.state === "complete" ? "Saved to project" : job.state === "error" ? job.message : `${job.progress}% uploaded`}</small></div><span className="upload-progress"><i style={{ width: `${job.progress}%` }} /></span></div>{job.state === "uploading" && <button type="button" onClick={() => void cancelUpload(job.id)} aria-label={`Pause ${job.name}`}>×</button>}</div>)}</div>}</div>;
}
