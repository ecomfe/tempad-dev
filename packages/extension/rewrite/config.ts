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
    markers: ['{type:"global",closePluginFunc:'],
    replacements: [
      {
        pattern: /{type:"global",closePluginFunc:[A-Za-z_$][A-Za-z0-9_$]*}/,
        replacer: '{type:"global",closePluginFunc:()=>{}}'
      }
    ]
  },
  {
    markers: ['let{canRunExtensions:'],
    replacements: [
      {
        pattern:
          /let\{canRunExtensions:([A-Za-z_$][A-Za-z0-9_$]*),canAccessFullDevMode:([A-Za-z_$][A-Za-z0-9_$]*)\}=([A-Za-z_$][A-Za-z0-9_$]*).openFile;/,
        replacer: 'let{canRunExtensions:$1,canAccessFullDevMode:$2}=$3.openFile;$1=true;'
      }
    ]
  }
]
