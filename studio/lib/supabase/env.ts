export function getSupabaseEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;
  return { url, key };
}

export function getStorageBucketName() {
  return process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim() || "CREATIVEXSTUDIO";
}
