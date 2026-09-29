import { isRecord } from "./guards.ts";

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): string | undefined {
	return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
}
