import type { Group } from '@/types/rewrite'

export const GROUPS: Group[] = [
  {
    markers: ['.appModel.isReadOnly'],
    replacements: [
      {
        pattern: /\.appModel\.isReadOnly/g,
        replacer: '.appModel.__isReadOnly__'
      }
    ]
  },
  {
    markers: ['dispnf.fyufotjpo;00', 'np{.fyufotjpo;00'],
    replacements: [
      {
        pattern: /dispnf\.fyufotjpo;00|np{\.fyufotjpo;00/g,
        replacer: 'FIGMA_PLEASE_STOP'
      }
    ]
  }
]
