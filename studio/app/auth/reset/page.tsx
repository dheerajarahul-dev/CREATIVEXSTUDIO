import { redirect } from "next/navigation";
import { updatePasswordAction } from "@/app/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/login?error=setup");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const params = await searchParams;

  return <main className="login-screen"><section className="login-panel reset-panel"><div className="login-mobile-brand"><span className="brand-mark">CX</span> CREATIVE X</div><span className="eyebrow">ACCOUNT SECURITY</span><h2>Choose a new password.</h2><p className="muted">Use at least 12 characters.</p>{params.error === "weak" && <p className="form-error" role="alert">Choose a password with at least 12 characters.</p>}<form action={updatePasswordAction}><label className="field-label" htmlFor="new-password">New password</label><input id="new-password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /><button className="button button-primary login-submit" type="submit">Update password <span>↗</span></button></form></section></main>;
}
