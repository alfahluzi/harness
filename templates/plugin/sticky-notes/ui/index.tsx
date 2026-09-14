import { useEffect, useState } from "react";

type Note = { id: string; text: string; ts: number };

const STORAGE_KEY = "puna:plugin:sticky-notes:v1";

function load(): Note[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Note[]) : [];
	} catch {
		return [];
	}
}

function save(notes: Note[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
	} catch {
		// ignore storage errors (private mode, quota)
	}
}

function newNote(text: string): Note {
	return { id: crypto.randomUUID(), text, ts: Date.now() };
}

/** Left-bar panel: note list + add/delete, persisted to localStorage. */
export function StickyNotesEntry() {
	const [notes, setNotes] = useState<Note[]>(load);
	const [draft, setDraft] = useState("");

	useEffect(() => {
		save(notes);
	}, [notes]);

	const addNote = () => {
		const text = draft.trim();
		if (!text) return;
		setNotes((arr) => [...arr, newNote(text)]);
		setDraft("");
	};

	return (
		<div className="flex flex-col gap-2 p-3 text-sm">
			<h3 className="font-semibold">Sticky Notes</h3>
			<ul className="flex flex-col gap-1">
				{notes.map((n) => (
					<li
						key={n.id}
						className="flex items-start gap-2 rounded border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900"
					>
						<span className="flex-1 break-words">{n.text}</span>
						<button
							type="button"
							aria-label="Delete note"
							className="text-neutral-400 hover:text-red-500"
							onClick={() =>
								setNotes((arr) => arr.filter((x) => x.id !== n.id))
							}
						>
							×
						</button>
					</li>
				))}
			</ul>
			<div className="flex gap-1">
				<input
					className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
					placeholder="New note…"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") addNote();
					}}
				/>
				<button
					type="button"
					className="rounded bg-slate-600 px-2 py-1 text-white hover:bg-slate-700"
					onClick={addNote}
				>
					Add
				</button>
			</div>
		</div>
	);
}

/**
 * Footer widget: note count, refreshed on an interval so the counter catches
 * edits made in the left-bar panel without a shared store.
 */
export function StickyNotesCounter() {
	const [count, setCount] = useState(0);

	useEffect(() => {
		const tick = () => setCount(load().length);
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, []);

	return <span className="mx-2">Notes: {count}</span>;
}

export default StickyNotesEntry;
