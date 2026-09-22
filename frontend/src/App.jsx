import { useCallback, useEffect, useState } from "react";
import { authApi } from "./features/auth/auth.api.js";
import { WorkspaceLogin } from "./features/auth/WorkspaceLogin.jsx";
import { profileApi } from "./features/profiles/profile.api.js";
import { ProfilePicker } from "./features/profiles/ProfilePicker.jsx";
import { Workspace } from "./features/shell/Workspace.jsx";
import {
	PROFILE_ID_KEY,
	SESSION_EXPIRED_EVENT,
	hasProfileToken,
	hasSessionToken,
	setProfileToken,
	setSessionToken,
} from "./shared/api/client.js";
import { BrandMark } from "./shared/components/BrandMark.jsx";
import { AppErrorFallback, ErrorBoundary } from "./shared/components/ErrorBoundary.jsx";
import { ToastProvider } from "./shared/components/Toast.jsx";
import { SessionProvider } from "./shared/context/SessionContext.jsx";

function AppBootScreen() {
	return (
		<main className="app-boot" aria-label="Opening Rheostat" role="status">
			<div className="app-boot-brand">
				<BrandMark />
				<strong>Rheostat</strong>
			</div>
			<div className="app-boot-progress" aria-hidden="true">
				<span />
			</div>
		</main>
	);
}

const clearStoredSession = () => {
	setProfileToken("");
	setSessionToken("");
	localStorage.removeItem(PROFILE_ID_KEY);
};

function AppRoot() {
	const [account, setAccount] = useState(null);
	const [session, setSession] = useState({ profile: null, permissions: [] });
	const [authLoading, setAuthLoading] = useState(false);
	const [bootstrapping, setBootstrapping] = useState(true);
	const [authError, setAuthError] = useState("");
	const [authRetryAfter, setAuthRetryAfter] = useState(0);
	const [profiles, setProfiles] = useState(null);
	const [profileError, setProfileError] = useState("");
	const [switchingFrom, setSwitchingFrom] = useState(null);

	const loadProfiles = useCallback(async () => {
		try {
			setProfileError("");
			setProfiles(await profileApi.list());
		} catch (error) {
			setProfileError(error.message);
			setProfiles([]);
		}
	}, []);

	useEffect(() => {
		const expire = (event) => {
			clearStoredSession();
			setAccount(null);
			setSession({ profile: null, permissions: [] });
			setProfiles(null);
			setSwitchingFrom(null);
			setAuthError(event.detail || "Your Rheostat session has expired.");
		};
		window.addEventListener(SESSION_EXPIRED_EVENT, expire);
		return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expire);
	}, []);

	useEffect(() => {
		let active = true;
		const restore = async () => {
			if (!hasSessionToken()) {
				if (active) setBootstrapping(false);
				return;
			}
			let restored = null;
			let restoreError = null;
			try {
				restored = await authApi.session();
			} catch (error) {
				restoreError = error;
				if (hasProfileToken()) {
					setProfileToken("");
					localStorage.removeItem(PROFILE_ID_KEY);
					try {
						restored = await authApi.session();
						restoreError = null;
					} catch (sessionError) {
						restoreError = sessionError;
					}
				}
			}
			if (!active) return;
			if (!restored) {
				clearStoredSession();
				setAuthError(restoreError?.message || "Your Rheostat session has expired.");
				setBootstrapping(false);
				return;
			}
			setAccount(restored.account);
			setSession({ profile: restored.profile, permissions: restored.permissions });
			setAuthError("");
			if (!restored.profile) await loadProfiles();
			if (active) setBootstrapping(false);
		};
		restore();
		return () => {
			active = false;
		};
	}, [loadProfiles]);

	const selectProfile = async (profile) => {
		try {
			setProfileError("");
			const result = await authApi.switchProfile(profile._id);
			setProfileToken(result.token);
			localStorage.setItem(PROFILE_ID_KEY, profile._id);
			setSession({ profile: result.profile, permissions: result.permissions });
			setSwitchingFrom(null);
		} catch (error) {
			setProfileError(error.message);
		}
	};

	const login = async (email, password) => {
		try {
			setAuthLoading(true);
			setAuthError("");
			const result = await authApi.login(email, password);
			setSessionToken(result.token);
			setAccount(result.account);
			let discovered = [];
			try {
				setProfileError("");
				discovered = await profileApi.list();
			} catch (error) {
				setProfileError(error.message);
			}
			setProfiles(discovered);
			const own = discovered.find((profile) => profile.email === result.account.email);
			if (own) await selectProfile(own);
		} catch (error) {
			setAuthError(error.message);
			setAuthRetryAfter(error.code === "RATE_LIMITED" ? error.retryAfterSeconds || 0 : 0);
		} finally {
			setAuthLoading(false);
		}
	};

	const logout = async () => {
		try {
			if (hasSessionToken()) await authApi.logout();
		} catch {
			// The server session is stateless; clearing local tokens is what signs the user out.
		}
		clearStoredSession();
		setAccount(null);
		setSession({ profile: null, permissions: [] });
		setProfiles(null);
		setSwitchingFrom(null);
		setAuthError("");
	};

	const switchProfile = async () => {
		setSwitchingFrom(session.profile);
		localStorage.removeItem(PROFILE_ID_KEY);
		setProfileToken("");
		setSession({ profile: null, permissions: [] });
		if (profiles === null) await loadProfiles();
	};

	if (bootstrapping) return <AppBootScreen />;
	if (!account) return <WorkspaceLogin error={authError} loading={authLoading} onLogin={login} retryAfterSeconds={authRetryAfter} />;
	if (session.profile) {
		return (
			<SessionProvider account={account} key={session.profile._id} permissions={session.permissions} profile={session.profile}>
				<ToastProvider>
					<Workspace onLogout={logout} onProfileSwitch={switchProfile} />
				</ToastProvider>
			</SessionProvider>
		);
	}
	return (
		<ProfilePicker
			error={profileError}
			loading={profiles === null}
			onLogout={logout}
			onRetry={loadProfiles}
			onSelect={selectProfile}
			profiles={(profiles || []).filter((profile) => profile._id !== switchingFrom?._id)}
			switchingFrom={switchingFrom}
		/>
	);
}

export default function App() {
	return (
		<ErrorBoundary fallback={(error) => <AppErrorFallback error={error} />}>
			<AppRoot />
		</ErrorBoundary>
	);
}
