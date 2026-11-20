/** Single Hebrew UI dictionary. Components read strings via `t()`, never hardcode them. */
export const he = {
  'app.name': 'CRM סוכנות',
  'nav.label': 'ניווט ראשי',
  'nav.dashboard': 'דוחות',
  'nav.clients': 'לקוחות',
  'nav.leads': 'לידים',
  'nav.tasks': 'משימות',
  'nav.activities': 'פעילויות',
  'nav.campaigns': 'קמפיינים',
  'nav.settings': 'הגדרות',
  'nav.comingSoon': 'בקרוב',
  'status.new': 'חדש',
  'status.inProgress': 'בטיפול',
  'status.awaitingReply': 'ממתין למענה',
  'status.won': 'נסגר בהצלחה',
  'status.notRelevant': 'לא רלוונטי',
  'system.title': 'מצב המערכת',
  'system.loading': 'בודק חיבור לשרת…',
  'system.ok': 'השרת ומסד הנתונים פעילים',
  'system.degraded': 'השרת פעיל, מסד הנתונים אינו זמין',
  'system.error': 'אין חיבור לשרת',
  'system.version': 'גרסה',
  'system.checkedAt': 'נבדק ב־',
} as const;

export type MessageKey = keyof typeof he;
