import {
  Activity,
  BadgeCheck,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Plug,
  Rocket,
  Settings,
  Sparkles,
} from 'lucide-react';
import type { TranslationKey } from '@proofhound/web-ui/i18n';
import type { NavGroup } from './types';

type TFunction = (key: TranslationKey) => string;

export function getMainNavGroups(t: TFunction): NavGroup[] {
  return [
    {
      title: t('nav.group.observability'),
      items: [
        { title: t('nav.dashboard'), url: '/dashboard', icon: LayoutDashboard },
        { title: t('nav.monitoring'), url: '/monitoring', icon: Activity },
      ],
    },
    {
      title: t('nav.group.assets'),
      items: [
        { title: t('nav.models'), url: '/models', icon: Cpu },
        { title: t('nav.datasets'), url: '/datasets', icon: Database },
        { title: t('nav.prompts'), url: '/prompts', icon: FileText },
      ],
    },
    {
      title: t('nav.group.development'),
      items: [
        { title: t('nav.experiments'), url: '/experiments', icon: FlaskConical },
        { title: t('nav.optimization'), url: '/optimizations', icon: Sparkles },
      ],
    },
    {
      title: t('nav.group.production'),
      items: [
        { title: t('nav.connectors'), url: '/connectors', icon: Plug },
        { title: t('nav.releases'), url: '/releases', icon: Rocket },
        { title: t('nav.annotations'), url: '/annotations', icon: BadgeCheck },
      ],
    },
    {
      title: t('nav.group.settings'),
      hideTitle: true,
      items: [
        { title: t('nav.settings'), url: '/settings', icon: Settings },
      ],
    },
  ];
}
