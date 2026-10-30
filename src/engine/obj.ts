export function getValue<T>(
	obj: Record<string, T> | undefined,
	key: string,
): T | undefined {
	return obj?.[key];
}
