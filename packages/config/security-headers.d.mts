export function securityHeaders(options: { production: boolean; formTargets?: string[] }): { source: string; headers: { key: string; value: string }[] }[];
