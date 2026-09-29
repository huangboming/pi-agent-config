import { spawn } from "node:child_process";

export function openUrl(url: string): void {
	const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	try {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.unref();
	} catch {
		// The caller still shows the URL for manual opening.
	}
}
