import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TwoFactorDialogComponent } from './components/ui/two-factor-dialog';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TwoFactorDialogComponent],
  template: `
    <!-- Este es el punto de entrada que cargará el LayoutComponent o el Login -->
    <router-outlet></router-outlet>
    <!-- Diálogo global de verificación 2FA (acciones destructivas) -->
    <app-two-factor-dialog />
  `,
})
export class AppComponent {}
