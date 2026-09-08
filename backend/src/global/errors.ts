/**
 * Shared error classes for the backend.
 */

/**
 * Thrown when a message is sent to a session whose LangGraph thread already
 * has an active run. Maps to HTTP 409 (Conflict) in route handlers.
 */
export class ThreadBusyError extends Error {
	constructor(threadId: string) {
		super(
			`Session is still running a task. Wait for it to finish before sending a new message. (thread ${threadId})`,
		);
		this.name = "ThreadBusyError";
	}
}