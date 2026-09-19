import { AudienceMember } from "../../features/evaluation/audience-member.model.js";
import { daysAgo, isoDate } from "./clock.js";
import { between, pick, prng } from "./prng.js";

const FIRST_NAMES = [
	"Aarav",
	"Amara",
	"Anika",
	"Beatriz",
	"Chidi",
	"Dana",
	"Elif",
	"Emeka",
	"Fatima",
	"Finn",
	"Gabriel",
	"Hana",
	"Hiro",
	"Imani",
	"Ines",
	"Jonas",
	"Kai",
	"Kwame",
	"Laila",
	"Leon",
	"Lucia",
	"Malik",
	"Maya",
	"Mei",
	"Nadia",
	"Niamh",
	"Noor",
	"Olamide",
	"Omar",
	"Priya",
	"Rafael",
	"Rosa",
	"Sana",
	"Santiago",
	"Sofia",
	"Tariq",
	"Theo",
	"Uma",
	"Viktor",
	"Wei",
	"Yara",
	"Yusuf",
	"Zainab",
	"Zoe",
];
const LAST_NAMES = [
	"Abebe",
	"Adeyemi",
	"Almeida",
	"Andersson",
	"Bauer",
	"Bergström",
	"Castillo",
	"Chen",
	"Costa",
	"Dubois",
	"Fernandes",
	"Gonzalez",
	"Haddad",
	"Hernandez",
	"Ivanova",
	"Jensen",
	"Kaur",
	"Kim",
	"Kowalski",
	"Lindqvist",
	"Mensah",
	"Moreau",
	"Nakamura",
	"Nguyen",
	"Novak",
	"Okafor",
	"Oliveira",
	"Patel",
	"Petrov",
	"Rahman",
	"Rossi",
	"Santos",
	"Schneider",
	"Silva",
	"Singh",
	"Tanaka",
	"Torres",
	"Varga",
	"Yamamoto",
	"Zhang",
];
const COUNTRIES = ["US", "US", "US", "GB", "DE", "FR", "NL", "ES", "IT", "SE", "IE", "PL", "CA", "AU", "BR", "IN", "JP", "MX", "NG", "KE"];
const COMPANIES = [
	"Northwind",
	"Contoso",
	"Globex",
	"Initech",
	"Umbrella Retail",
	"Hooli",
	"Vandelay",
	"Stark Goods",
	"Wayne Supply",
	"Rheostat",
	"",
];

const semver = (random, major) => `${major}.${between(random, 0, 14)}.${between(random, 0, 9)}`;

function member(random, project, index) {
	const first = pick(random, FIRST_NAMES);
	const last = pick(random, LAST_NAMES);
	const planRoll = random();
	const plan = planRoll < 0.55 ? "free" : planRoll < 0.85 ? "pro" : "enterprise";
	const platform =
		project.key === "mobile" ? (random() < 0.55 ? "ios" : "android") : random() < 0.8 ? "web" : pick(random, ["ios", "android"]);
	const major = platform === "web" ? 1 : random() < 0.7 ? 6 : 5;
	return {
		projectId: project._id,
		key: `${first}-${last}-${index}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
		name: `${first} ${last}`,
		attributes: {
			country: pick(random, COUNTRIES),
			plan,
			platform,
			appVersion: semver(random, major),
			betaOptIn: random() < 0.25,
			signupDate: isoDate(daysAgo(between(random, 1, 1100))),
			company: plan === "free" ? "" : pick(random, COMPANIES),
		},
	};
}

// 500 members per project from a fixed seed, so every reseed (and every README number) matches.
export function buildAudience(projects, size = 500) {
	const random = prng(20260918);
	return projects.projects.flatMap((project) => Array.from({ length: size }, (_, index) => member(random, project, index + 1)));
}

export async function seedAudience(projects) {
	console.log("\nSeeding synthetic audience...");
	const members = await AudienceMember.insertMany(buildAudience(projects));
	console.log(`  Created ${members.length} audience members (${members.length / projects.projects.length} per project)`);
	return members;
}
