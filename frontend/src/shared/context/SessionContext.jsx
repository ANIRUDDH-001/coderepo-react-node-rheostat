import { createContext, useContext, useMemo } from "react";

const SessionContext = createContext({ account: null, profile: null, permissions: [], can: () => false });

export function SessionProvider({ account, children, permissions = [], profile }) {
	const value = useMemo(() => {
		const granted = new Set(permissions);
		return { account, profile, permissions, can: (action) => granted.has(action) };
	}, [account, permissions, profile]);
	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
