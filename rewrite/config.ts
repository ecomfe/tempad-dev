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
    markers: ['i=(0,_.rd)()||n;if(!i)'],
    replacements: [
      {
        pattern: 'i=(0,_.rd)()||n;if(!i)',
        replacer: 'i=(0,_.rd)()||n;if(false)'
      },
      {
        pattern: 'if((0,ee.et)())return;i&&',
        replacer: 'if((0,ee.et)())return;true&&'
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
