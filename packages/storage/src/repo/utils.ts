export function nowIso(): string {
	return new Date().toISOString();
}

export function toJson(value: unknown): string {
	return JSON.stringify(value ?? null);
}

export function optionalJson(value: unknown): string | null {
	if (value === undefined) {
		return null;
	}
	return toJson(value);
}

export function assertRow<T>(row: unknown, message: string): T {
	if (!row) {
		throw new Error(message);
	}
	return row as T;
}
