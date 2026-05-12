import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `
    <!-- Este es el punto de entrada que cargará el LayoutComponent o el Login -->
    <router-outlet></router-outlet>
  `,
})
export class AppComponent {}
