import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";

const STORAGE_KEY = "puna:configDir";

interface ActiveWorkdir {
	configDir: string;
	setConfigDir: (next: string) => void;
}

const ActiveWorkdirContext = createContext<ActiveWorkdir | null>(null);

function readInitial(): string {
	if (typeof window === "undefined") return "";
	try {
		return window.localStorage.getItem(STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

export function ActiveWorkdirProvider({ children }: { children: ReactNode }) {
	const [configDir, setConfigDirState] = useState<string>(readInitial);

	const setConfigDir = useCallback((next: string) => {
		setConfigDirState(next);
		try {
			if (next) window.localStorage.setItem(STORAGE_KEY, next);
			else window.localStorage.removeItem(STORAGE_KEY);
		} catch {
			// ignore storage errors (private mode, quota)
		}
	}, []);

	useEffect(() => {
		function onStorage(e: StorageEvent) {
			if (e.key === STORAGE_KEY) {
				setConfigDirState(e.newValue ?? "");
			}
		}
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	return (
		<ActiveWorkdirContext.Provider value={{ configDir, setConfigDir }}>
			{children}
		</ActiveWorkdirContext.Provider>
	);
}

export function useActiveWorkdir(): ActiveWorkdir {
	const ctx = useContext(ActiveWorkdirContext);
	if (!ctx) throw new Error("useActiveWorkdir must be used inside ActiveWorkdirProvider");
	return ctx;
}