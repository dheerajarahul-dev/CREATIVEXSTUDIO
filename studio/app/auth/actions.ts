"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });
const emailSchema = z.email().max(254);

function safeStudioPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/studio") && !path.startsWith("//") ? path : "/studio";
}

export async function loginAction(formData: FormData) {
  const parsed = credentialsSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) redirect("/login?error=invalid");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?error=setup");

  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) redirect("/login?error=invalid");

  redirect(safeStudioPath(formData.get("next")));
}

export async function passwordResetRequestAction(formData: FormData) {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) redirect("/login?mode=reset&reset=sent");

  const supabase = await createSupabaseServerClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (supabase && siteUrl) {
    await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${siteUrl}/auth/callback?next=/auth/reset` });
  }
  redirect("/login?mode=reset&reset=sent");
}

export async function updatePasswordAction(formData: FormData) {
  const password = z.string().min(12).max(128).safeParse(formData.get("password"));
  if (!password.success) redirect("/auth/reset?error=weak");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?error=setup");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=invalid");

  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) redirect("/auth/reset?error=weak");
  redirect("/login?password=updated");
}

export async function logoutAction() {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}
