import { Suspense } from "react";
import Link from "next/link";
import { loginAction, passwordResetRequestAction } from "@/app/auth/actions";

type Props = { searchParams: Promise<{ error?: string; mode?: string; reset?: string; password?: string; next?: string }> };

export default function LoginPage({ searchParams }: Props) {
  return <Suspense fallback={<main className="loading-screen">Loading sign in…</main>}><LoginContent searchParams={searchParams} /></Suspense>;
}

async function LoginContent({ searchParams }: Props) {
  const params = await searchParams;
  const resetting = params.mode === "reset";
  const message = params.error === "setup"
    ? "Studio authentication is not configured yet. Follow the local setup guide."
    : params.error === "invalid"
      ? "Sign-in failed. Check your details or request a password reset."
      : params.error === "suspended"
        ? "This account is not currently active. Contact your workspace administrator."
          : params.error === "invitation"
            ? "This sign-in link is not a valid workspace invitation. Ask your administrator to send a new invite."
        : params.password === "updated"
          ? "Your password has been updated. Sign in with your new password."
          : params.reset === "sent"
            ? "If this account is registered, password-reset instructions have been sent."
            : "";

  return <main className="login-screen"><div className="login-art"><div className="login-art-image" /><div className="login-art-shade" /><div className="login-brand"><span className="brand-mark">CX</span><span>CREATIVE X <small>PRODUCTION STUDIO</small></span></div><div className="login-quote"><span className="eyebrow">PRIVATE PRODUCTION WORKSPACE</span><h1>Good work.<br /><em>Made together.</em></h1><p>Projects, reviews, and final handoffs in one secure workspace.</p></div><span className="login-image-note">CREATIVE X · STUDIO</span></div><section className="login-panel"><div className="login-mobile-brand"><span className="brand-mark">CX</span> CREATIVE X</div><span className="eyebrow">INVITED WORKSPACE</span><h2>{resetting ? "Reset password." : "Welcome back."}</h2><p className="muted">{resetting ? "Enter your account email to request a secure reset link." : "Sign in to your production workspace."}</p>{message && <p className={params.error ? "form-error" : "auth-notice"} role="status">{message}</p>}{resetting ? <form action={passwordResetRequestAction}><label className="field-label" htmlFor="reset-email">Email address</label><input id="reset-email" name="email" type="email" maxLength={254} autoComplete="email" required /><button className="button button-primary login-submit" type="submit">Send reset link <span>↗</span></button></form> : <form action={loginAction}><input type="hidden" name="next" value={params.next ?? "/studio"} /><label className="field-label" htmlFor="login-email">Email address</label><input id="login-email" name="email" type="email" maxLength={254} autoComplete="username" defaultValue="dheeraj@gmail.com" required /><label className="field-label" htmlFor="login-password">Password</label><input id="login-password" name="password" type="password" maxLength={128} autoComplete="current-password" required /><button className="button button-primary login-submit" type="submit">Enter your studio <span>↗</span></button></form>}<div className="login-local-note"><i /> Invite-only workspace <span>·</span> Secured by Supabase Auth</div><Link className="auth-link" href={resetting ? "/login" : "/login?mode=reset"}>{resetting ? "Back to sign in" : "Forgot password?"}</Link></section></main>;
}
