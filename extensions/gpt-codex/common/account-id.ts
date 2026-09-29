const DISPLAY_ID_LENGTHS = [
	[6, 4],
	[8, 6],
	[10, 8],
	[12, 12],
] as const;

export function shortenAccountId(accountId: string, prefixLength = 6, suffixLength = 4): string {
	if (accountId.length <= prefixLength + suffixLength + 1) return accountId;
	return `${accountId.slice(0, prefixLength)}…${accountId.slice(-suffixLength)}`;
}

export function uniqueAccountDisplayIds(accountIds: string[]): Map<string, string> {
	for (const [prefixLength, suffixLength] of DISPLAY_ID_LENGTHS) {
		const labels = accountIds.map((id) => shortenAccountId(id, prefixLength, suffixLength));
		if (new Set(labels).size === labels.length) {
			return new Map(accountIds.map((id, index) => [id, labels[index] ?? id]));
		}
	}
	return new Map(accountIds.map((id) => [id, id]));
}
