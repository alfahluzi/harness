import { resolve as nodeResolve, relative as nodeRelative, sep as nodeSep } from "node:path";

export class PathResolver {
	constructor(public readonly root: string) {}

	resolve(relPath: string): string {
		return nodeResolve(this.root, relPath);
	}

	relative(absPath: string): string {
		return nodeRelative(this.root, absPath);
	}

	isInside(absPath: string): boolean {
		const normRoot = nodeResolve(this.root);
		const normAbs = nodeResolve(absPath);
		return normAbs === normRoot || normAbs.startsWith(normRoot + nodeSep);
	}
}