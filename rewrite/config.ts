import type { Group } from '@/types/rewrite'

export const GROUPS: Group[] = [
  {
    markers: ['.appModel.isReadOnly'],
    replacements: [
      {
        pattern: '.appModel.isReadOnly',
        replacer: '.appModel.__isReadOnly__'
      }
    ]
  },
  {
    markers: ['const __html__ = (() => {'],
    replacements: [
      {
        pattern:
          /([A-Za-z_$][A-Za-z0-9_$]*)=\(0,([A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*)\)\(\)\|\|([A-Za-z_$][A-Za-z0-9_$]*);if\(!\1\)/,
        replacer: '$1=(0,$2)()||$3;if(false)'
      },
      {
        pattern:
          /if\(\(0,([A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*)\)\(\)\)return;([A-Za-z_$][A-Za-z0-9_$]*)&&/,
        replacer: 'if((0,$1)())return;true&&'
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
  },
  {
    markers: ['ext_init_wdf'],
    replacements: [
      {
        pattern: 'ext_init_wdf',
        replacer: '__ext_init_wdf__'
      }
    ]
  }
]
