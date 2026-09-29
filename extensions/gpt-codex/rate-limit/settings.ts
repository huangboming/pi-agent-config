import type { SettingItem } from "@earendil-works/pi-tui";

import { readAccountStore, updateAccountStore } from "../account/store.ts";
import { isRecord } from "../common/guards.ts";

const RATE_LIMIT_REFRESH_INTERVAL_OPTIONS = [
	{ label: "1m", intervalMs: 60_000 },
	{ label: "5m", intervalMs: 5 * 60_000 },
	{ label: "10m", intervalMs: 10 * 60_000 },
	{ label: "30m", intervalMs: 30 * 60_000 },
	{ label: "1h", intervalMs: 60 * 60_000 },
] as const;

export type RateLimitsStatusSettings = {
	enabled: boolean;
	periodicRefresh: boolean;
	intervalMs: number;
	refreshOnAgentEnd: boolean;
	refreshOnTurnEnd: boolean;
	refreshOnToolExecutionEnd: boolean;
};

export const DEFAULT_RATE_LIMITS_STATUS_SETTINGS: RateLimitsStatusSettings = {
	enabled: true,
	periodicRefresh: true,
	intervalMs: 5 * 60_000,
	refreshOnAgentEnd: true,
	refreshOnTurnEnd: false,
	refreshOnToolExecutionEnd: true,
};

function booleanSetting(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function intervalSetting(value: unknown): number {
	return RATE_LIMIT_REFRESH_INTERVAL_OPTIONS.some((option) => option.intervalMs === value)
		? (value as number)
		: DEFAULT_RATE_LIMITS_STATUS_SETTINGS.intervalMs;
}

function parseRateLimitsStatusSettings(value: unknown): RateLimitsStatusSettings {
	const input = isRecord(value) ? value : {};
	return {
		enabled: booleanSetting(input.enabled, DEFAULT_RATE_LIMITS_STATUS_SETTINGS.enabled),
		periodicRefresh: booleanSetting(input.periodicRefresh, DEFAULT_RATE_LIMITS_STATUS_SETTINGS.periodicRefresh),
		intervalMs: intervalSetting(input.intervalMs),
		refreshOnAgentEnd: booleanSetting(input.refreshOnAgentEnd, DEFAULT_RATE_LIMITS_STATUS_SETTINGS.refreshOnAgentEnd),
		refreshOnTurnEnd: booleanSetting(input.refreshOnTurnEnd, DEFAULT_RATE_LIMITS_STATUS_SETTINGS.refreshOnTurnEnd),
		refreshOnToolExecutionEnd: booleanSetting(
			input.refreshOnToolExecutionEnd,
			DEFAULT_RATE_LIMITS_STATUS_SETTINGS.refreshOnToolExecutionEnd,
		),
	};
}

function refreshIntervalLabel(intervalMs: number): string {
	return RATE_LIMIT_REFRESH_INTERVAL_OPTIONS.find((option) => option.intervalMs === intervalMs)?.label ?? "5m";
}

function refreshIntervalFromLabel(label: string): number | undefined {
	return RATE_LIMIT_REFRESH_INTERVAL_OPTIONS.find((option) => option.label === label)?.intervalMs;
}

export function readRateLimitsStatusSettings(): RateLimitsStatusSettings {
	return parseRateLimitsStatusSettings(readAccountStore().settings?.rateLimitsStatus);
}

function saveRateLimitsStatusSettings(settings: RateLimitsStatusSettings): void {
	updateAccountStore((store) => {
		store.settings = {
			...(store.settings ?? {}),
			rateLimitsStatus: parseRateLimitsStatusSettings(settings),
		};
	});
}

export function rateLimitsStatusSettingsItems(): SettingItem[] {
	const settings = readRateLimitsStatusSettings();
	return [
		{
			id: "enabled",
			label: "Rate-limit status",
			currentValue: settings.enabled ? "enabled" : "disabled",
			values: ["enabled", "disabled"],
		},
		{
			id: "periodicRefresh",
			label: "Periodic refresh",
			currentValue: settings.periodicRefresh ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "intervalMs",
			label: "Refresh interval",
			currentValue: refreshIntervalLabel(settings.intervalMs),
			values: RATE_LIMIT_REFRESH_INTERVAL_OPTIONS.map((option) => option.label),
		},
		{
			id: "refreshOnAgentEnd",
			label: "After agent completes",
			currentValue: settings.refreshOnAgentEnd ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "refreshOnTurnEnd",
			label: "After each turn completes",
			currentValue: settings.refreshOnTurnEnd ? "on" : "off",
			values: ["on", "off"],
		},
		{
			id: "refreshOnToolExecutionEnd",
			label: "After each tool completes",
			currentValue: settings.refreshOnToolExecutionEnd ? "on" : "off",
			values: ["on", "off"],
		},
	];
}

export function updateRateLimitsStatusSetting(id: string, value: string): boolean {
	const settings = readRateLimitsStatusSettings();
	const next = { ...settings };

	if (id === "enabled") next.enabled = value === "enabled";
	else if (id === "periodicRefresh") next.periodicRefresh = value === "on";
	else if (id === "intervalMs") next.intervalMs = refreshIntervalFromLabel(value) ?? next.intervalMs;
	else if (id === "refreshOnAgentEnd") next.refreshOnAgentEnd = value === "on";
	else if (id === "refreshOnTurnEnd") next.refreshOnTurnEnd = value === "on";
	else if (id === "refreshOnToolExecutionEnd") next.refreshOnToolExecutionEnd = value === "on";
	else return false;

	saveRateLimitsStatusSettings(next);
	return true;
}
