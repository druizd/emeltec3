import { Component } from '@angular/core';

/**
 * Base skeleton primitive. Apply size + shape via Tailwind class attribute.
 *
 * Examples:
 *   <app-skeleton class="h-8 w-32 rounded"></app-skeleton>
 *   <app-skeleton class="h-12 w-12 rounded-full"></app-skeleton>
 *   <app-skeleton class="h-3 w-20 rounded-sm"></app-skeleton>
 *
 * Honors prefers-reduced-motion via global rule in styles.css.
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  template: '',
  host: {
    class: 'block animate-pulse bg-slate-200/80',
    'aria-hidden': 'true',
  },
})
export class SkeletonComponent {}
