import { BrandMark } from "../../shared/components/BrandMark.jsx";
import { ProfileMenu } from "./ProfileMenu.jsx";

export function TopBar({ children = null, onLogout, onProfileSwitch, profile }) {
	return (
		<header className="app-header">
			<div className="brand">
				<BrandMark />
				<span>Rheostat</span>
			</div>
			{children}
			<div className="header-actions">
				<ProfileMenu onLogout={onLogout} onProfileSwitch={onProfileSwitch} profile={profile} />
			</div>
		</header>
	);
}
