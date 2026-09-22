import { useEffect, useState } from "react";
import { BrandMark } from "../../shared/components/BrandMark.jsx";
import { useCountdown } from "../../shared/hooks/useCountdown.js";

export function WorkspaceLogin({ error = "", loading = false, onLogin = () => {}, retryAfterSeconds = 0 }) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const { secondsLeft, start } = useCountdown();
	// A 429 carries Retry-After; the button counts it down instead of inviting another rejected attempt.
	useEffect(() => {
		if (retryAfterSeconds > 0) start(retryAfterSeconds);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [retryAfterSeconds, error]);
	const submit = (event) => {
		event.preventDefault();
		onLogin(email.trim(), password);
	};
	return (
		<main className="workspace-login-page">
			<section className="workspace-login-card" aria-labelledby="workspace-login-title">
				<div className="workspace-login-mark">
					<BrandMark />
				</div>
				<h1 id="workspace-login-title">Sign in</h1>
				<p className="workspace-login-subtitle">to continue to Rheostat</p>
				<form onSubmit={submit}>
					<div className="outlined-input">
						<input
							autoComplete="username"
							disabled={loading}
							id="workspace-email"
							inputMode="email"
							placeholder=" "
							required
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
						<label htmlFor="workspace-email">Email</label>
					</div>
					<div className="outlined-input">
						<input
							autoComplete="current-password"
							disabled={loading}
							id="workspace-password"
							name="password"
							placeholder=" "
							required
							type="password"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
						<label htmlFor="workspace-password">Password</label>
					</div>
					{error && (
						<p className="workspace-login-error" role="alert">
							{error}
						</p>
					)}
					<div className="workspace-login-actions">
						<button className="primary-button" disabled={loading || secondsLeft > 0} type="submit">
							{loading ? "Signing in…" : secondsLeft > 0 ? `Try again in ${secondsLeft}s` : "Next"}
						</button>
					</div>
				</form>
			</section>
			<footer className="workspace-login-footer">
				<span>English (United States)</span>
				<span>Privacy</span>
				<span>Terms</span>
			</footer>
		</main>
	);
}
