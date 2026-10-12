import rules from '@/public/rules/figma.json'

const target = rules.find(({ id }) => id === 2)?.condition.regexFilter
if (!target) throw new Error('Missing bundled script rewrite rule.')

// DNR regex filters are case-insensitive by default.
export const REWRITE_TARGET_REGEX = new RegExp(target, 'i')
