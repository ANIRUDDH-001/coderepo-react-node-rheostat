import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { applyTheme, readTheme } from "../../shared/utils/theme.js";
import { roleLabel } from "../../shared/utils/roles.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";

const THEMES = [
	{ value: "light", label: "Light", icon: "light_mode" },
	{ value: "dark", label: "Dark", icon: "dark_mode" },
];

export function ProfileMenu({ onLogout, onProfileSwitch, profile }) {
	const [open, setOpen] = useState(false);
	const [theme, setTheme] = useState(readTheme);
	const reference = useRef(null);
	useEffect(() => {
		if (!open) return undefined;
		const closeOutside = (event) => {
			if (!reference.current?.contains(event.target)) setOpen(false);
		};
		const closeOnEscape = (event) => {
			if (event.key === "Escape") {
				setOpen(false);
				reference.current?.querySelector(".header-profile-button")?.focus();
			}
		};
		document.addEventListener("pointerdown", closeOutside);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);
	return (
		<div className="profile-menu-anchor" ref={reference}>
			<button
				className="header-profile-button"
				aria-label={`${profile.name} profile menu`}
				aria-expanded={open}
				aria-haspopup="menu"
				onClick={() => setOpen((value) => !value)}
			>
				<ProfileAvatar profile={profile} size="small" />
			</button>
			{open && (
				<div className="profile-menu" role="menu" aria-label="Profile menu">
					<div className="profile-menu-identity">
						<span className="profile-menu-label">{roleLabel(profile.role).toUpperCase()}</span>
						<ProfileAvatar profile={profile} size="medium" />
						<strong>{profile.name}</strong>
						<span>{profile.email}</span>
					</div>
					<div className="profile-menu-appearance" role="group" aria-label="Appearance">
						<span>Appearance</span>
						<div className="theme-toggle">
							{THEMES.map((option) => (
								<button
									key={option.value}
									type="button"
									aria-pressed={theme === option.value}
									onClick={() => setTheme(applyTheme(option.value))}
								>
									<MaterialIcon size={18}>{option.icon}</MaterialIcon>
									<span>{option.label}</span>
								</button>
							))}
						</div>
					</div>
					<button
						className="profile-switch-button"
						role="menuitem"
						aria-label="Switch profile"
						onClick={() => {
							setOpen(false);
							onProfileSwitch();
						}}
					>
						<span className="profile-switch-icon">
							<MaterialIcon size={21}>group</MaterialIcon>
						</span>
						<span>
							<strong>Switch profile</strong>
							<small>Work as a different role</small>
						</span>
						<MaterialIcon size={20}>chevron_right</MaterialIcon>
					</button>
					<button
						className="profile-signout-button"
						role="menuitem"
						onClick={() => {
							setOpen(false);
							onLogout();
						}}
					>
						<MaterialIcon size={19}>logout</MaterialIcon>
						<span>Sign out</span>
					</button>
				</div>
			)}
		</div>
	);
}
