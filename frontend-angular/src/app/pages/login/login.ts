import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../services/auth.service';
import type { ApiResponse, User } from '@emeltec/shared';

interface LoginResponse extends ApiResponse<unknown> {
  token?: string;
  user?: User;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
})
export class LoginComponent {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private router = inject(Router);

  email = signal('');
  password = signal('');
  isCodeSent = signal(false);
  successMsg = signal<string | null>(null);
  errorMsg = signal<string | null>(null);
  isSubmitting = signal(false);

  private getApiError(err: HttpErrorResponse | Error | null, fallback: string): string {
    if (!err) return fallback;
    if (err instanceof HttpErrorResponse) {
      return err.error?.error || err.error?.message || err.message || fallback;
    }
    return err.message || fallback;
  }

  handleRequestCode(event: Event): void {
    event.preventDefault();
    this.errorMsg.set(null);
    this.successMsg.set(null);
    this.isSubmitting.set(true);

    this.http.post<LoginResponse>('/api/auth/request-code', { email: this.email() }).subscribe({
      next: (res) => {
        if (res.ok) {
          this.isCodeSent.set(true);
          this.successMsg.set(res.message ?? null);
        } else {
          this.isCodeSent.set(false);
          this.errorMsg.set(res.error ?? res.message ?? 'No se pudo enviar el codigo.');
        }
        this.isSubmitting.set(false);
      },
      error: (err) => {
        this.isCodeSent.set(false);
        this.errorMsg.set(
          this.getApiError(err, 'No se pudo enviar el codigo. Intenta nuevamente.'),
        );
        this.isSubmitting.set(false);
      },
    });
  }

  handleLogin(event: Event): void {
    event.preventDefault();
    this.errorMsg.set(null);
    this.successMsg.set(null);
    this.isSubmitting.set(true);

    this.http
      .post<LoginResponse>('/api/auth/login', { email: this.email(), password: this.password() })
      .subscribe({
        next: (res) => {
          if (res.ok && res.token && res.user) {
            this.auth.login(res.token, res.user);
            this.router.navigate(['/dashboard']);
          }
          this.isSubmitting.set(false);
        },
        error: (err) => {
          this.errorMsg.set(this.getApiError(err, 'Fallo al conectar con el servidor.'));
          this.isSubmitting.set(false);
        },
      });
  }

  goToCodeEntry(): void {
    this.isCodeSent.set(true);
  }

  goBack(): void {
    this.isCodeSent.set(false);
  }
}
