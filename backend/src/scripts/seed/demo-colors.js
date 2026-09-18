// Avatar colors for the seeded people, keyed by email so the palette is stable across reseeds.
export const demoAvatarColors = {
	"priya.raman@rheostat.team": "#1a73e8",
	"marcus.chen@rheostat.team": "#0b8043",
	"elena.novak@rheostat.team": "#c2185b",
	"diego.alvarez@rheostat.team": "#b85c00",
	"sam.okafor@rheostat.team": "#7b1fa2",
};

export const avatarColorFor = (email) => demoAvatarColors[email] || "#5f6368";
