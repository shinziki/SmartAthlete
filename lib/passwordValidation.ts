export type PasswordRule = {
    key: string;
    label: string;
    test: (password: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
    { key: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
    { key: 'upper', label: 'At least 1 uppercase letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
    { key: 'lower', label: 'At least 1 lowercase letter (a-z)', test: (p) => /[a-z]/.test(p) },
    { key: 'number', label: 'At least 1 number (0-9)', test: (p) => /[0-9]/.test(p) },
    { key: 'symbol', label: 'At least 1 symbol (e.g. ! @ # $ %)', test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

export function getPasswordError(password: string): string | null {
    const failed = PASSWORD_RULES.filter((rule) => !rule.test(password));
    if (failed.length === 0) return null;
    return (
        'Password must have: ' +
        failed.map((r) => r.label.replace(/^At least /, '')).join(', ') +
        '.'
    );
}