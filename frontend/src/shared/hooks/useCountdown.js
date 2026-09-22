import { useEffect, useState } from "react";

// Seconds remaining until a moment; ticks once a second while positive.
export function useCountdown() {
	const [until, setUntil] = useState(0);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (until <= Date.now()) return undefined;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [until]);
	const secondsLeft = Math.max(0, Math.ceil((until - now) / 1000));
	return { secondsLeft, start: (seconds) => { setNow(Date.now()); setUntil(Date.now() + seconds * 1000); } };
}
