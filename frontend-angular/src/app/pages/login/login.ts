import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { ApiResponse, User } from '@emeltec/shared';
import type { Observable } from 'rxjs';
import { AuthService } from '../../services/auth.service';

type LoginStep = 'email' | 'setup_password' | 'setup_otp' | 'password' | 'otp' | 'mfa';
type LoginFlow = 'setup' | 'password' | 'otp';

interface LoginStartResponse extends ApiResponse<unknown> {
  flow?: LoginFlow;
  expires_at?: string;
}

interface LoginResponse extends ApiResponse<unknown> {
  token?: string;
  user?: User;
  requires_otp?: boolean;
  challenge_token?: string;
}

interface SetupStartResponse extends ApiResponse<unknown> {
  setup_token?: string;
  expires_at?: string;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
})
export class LoginComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly currentYear = new Date().getFullYear();
  readonly step = signal<LoginStep>('email');
  readonly email = signal('');
  readonly password = signal('');
  readonly confirmPassword = signal('');
  readonly otpCode = signal('');
  readonly setupToken = signal('');
  readonly mfaChallengeToken = signal('');
  readonly showPassword = signal(false);
  readonly showConfirmPassword = signal(false);
  readonly successMsg = signal<string | null>(null);
  readonly errorMsg = signal<string | null>(null);
  readonly isSubmitting = signal(false);
  readonly passwordStrength = computed(() => this.scorePassword(this.password()));
  readonly passwordsMatch = computed(
    () => !this.confirmPassword() || this.password() === this.confirmPassword(),
  );
  readonly canSubmitCurrentStep = computed(() => {
    if (this.isSubmitting()) return false;
    if (this.step() === 'setup_password') return this.canStartSetup();
    if (this.step() === 'password') return this.password().length > 0;
    if (this.step() === 'setup_otp' || this.step() === 'otp' || this.step() === 'mfa') {
      return this.otpCode().trim().length === 6;
    }
    return this.email().trim().length > 0;
  });

  get title(): string {
    return (
      {
        email: 'Ingresa tu correo',
        setup_password: 'Cuenta nueva',
        setup_otp: 'Confirma tu correo',
        password: 'Ingresa tu contrasena',
        otp: 'Codigo de acceso',
        mfa: 'Verificacion 2FA',
      } satisfies Record<LoginStep, string>
    )[this.step()];
  }

  get subtitle(): string {
    return (
      {
        email: 'El sistema revisara el metodo configurado para tu cuenta.',
        setup_password: 'Ingresa una contrasena para iniciar sesion.',
        setup_otp: 'Escribe el codigo enviado para activar la cuenta.',
        password: 'Usa la contrasena configurada para este correo.',
        otp: 'Revisa tu correo y escribe el codigo de un solo uso.',
        mfa: 'Confirma la sesion con el codigo enviado a tu correo.',
      } satisfies Record<LoginStep, string>
    )[this.step()];
  }

  get primaryText(): string {
    return (
      {
        email: 'Continuar',
        setup_password: 'Enviar codigo OTP',
        setup_otp: 'Activar cuenta',
        password: 'Iniciar sesion',
        otp: 'Confirmar acceso',
        mfa: 'Confirmar acceso',
      } satisfies Record<LoginStep, string>
    )[this.step()];
  }

  handleSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmitCurrentStep()) {
      if (this.step() === 'setup_password' && this.password() !== this.confirmPassword()) {
        this.errorMsg.set('Las contrasenas no coinciden.');
      }
      return;
    }
    const actions: Record<LoginStep, () => void> = {
      email: () => this.startLogin(),
      setup_password: () => this.startSetup(),
      setup_otp: () => this.completeSetup(),
      password: () => this.loginWithPassword(),
      otp: () => this.loginWithOtp(),
      mfa: () => this.completeMfa(),
    };
    actions[this.step()]();
  }

  goBack(): void {
    this.errorMsg.set(null);
    this.successMsg.set(null);
    this.password.set('');
    this.confirmPassword.set('');
    this.otpCode.set('');
    this.setupToken.set('');
    this.mfaChallengeToken.set('');
    this.showPassword.set(false);
    this.showConfirmPassword.set(false);
    this.step.set('email');
  }

  get strengthLabel(): string {
    return ['Muy debil', 'Debil', 'Media', 'Buena', 'Fuerte'][this.passwordStrength()];
  }

  get strengthColor(): string {
    return ['bg-rose-400', 'bg-orange-400', 'bg-amber-400', 'bg-teal-400', 'bg-emerald-500'][
      this.passwordStrength()
    ];
  }

  private startLogin(): void {
    this.run<LoginStartResponse>(
      () => this.http.post<LoginStartResponse>('/api/auth/start', { email: this.email().trim() }),
      (res) => {
        if (res.flow === 'setup') this.step.set('setup_password');
        else if (res.flow === 'password') this.step.set('password');
        else if (res.flow === 'otp') this.step.set('otp');
        else this.errorMsg.set(res.error ?? 'No se pudo determinar el metodo de ingreso.');

        this.successMsg.set(res.flow === 'otp' ? (res.message ?? 'Codigo enviado.') : null);
      },
      'No se pudo iniciar el acceso.',
    );
  }

  private startSetup(): void {
    const password = this.password();
    if (password.length < 8)
      return this.errorMsg.set('La contrasena debe tener al menos 8 caracteres.');
    if (password !== this.confirmPassword())
      return this.errorMsg.set('Las contrasenas no coinciden.');

    this.run<SetupStartResponse>(
      () =>
        this.http.post<SetupStartResponse>('/api/auth/setup/start', {
          email: this.email().trim(),
          new_password: password,
        }),
      (res) => {
        this.setupToken.set(res.setup_token ?? '');
        this.otpCode.set('');
        this.step.set('setup_otp');
        this.successMsg.set(res.message ?? 'Codigo enviado a tu correo.');
      },
      'No se pudo enviar el codigo de activacion.',
    );
  }

  private canStartSetup(): boolean {
    return (
      this.password().length >= 8 &&
      this.passwordStrength() >= 2 &&
      this.confirmPassword().length > 0 &&
      this.password() === this.confirmPassword()
    );
  }

  private scorePassword(value: string): number {
    if (!value) return 0;

    let score = 0;
    if (value.length >= 8) score += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    if (value.length >= 12 && score < 4) score += 1;

    return Math.min(score, 4);
  }

  private completeSetup(): void {
    this.run<LoginResponse>(
      () =>
        this.http.post<LoginResponse>('/api/auth/setup/complete', {
          email: this.email().trim(),
          new_password: this.password(),
          otp_code: this.otpCode().trim(),
          setup_token: this.setupToken(),
        }),
      (res) => this.finishAuth(res),
      'No se pudo activar la cuenta.',
    );
  }

  private loginWithPassword(): void {
    this.run<LoginResponse>(
      () =>
        this.http.post<LoginResponse>('/api/auth/login', {
          email: this.email().trim(),
          password: this.password(),
          mode: 'password',
        }),
      (res) => {
        if (res.requires_otp && res.challenge_token) {
          this.mfaChallengeToken.set(res.challenge_token);
          this.otpCode.set('');
          this.step.set('mfa');
          this.successMsg.set(res.message ?? 'Codigo enviado a tu correo.');
          return;
        }
        this.finishAuth(res);
      },
      'No se pudo iniciar sesion.',
    );
  }

  private loginWithOtp(): void {
    this.run<LoginResponse>(
      () =>
        this.http.post<LoginResponse>('/api/auth/login', {
          email: this.email().trim(),
          password: this.otpCode().trim(),
          mode: 'otp',
        }),
      (res) => this.finishAuth(res),
      'Codigo invalido o expirado.',
    );
  }

  private completeMfa(): void {
    this.run<LoginResponse>(
      () =>
        this.http.post<LoginResponse>('/api/auth/login', {
          email: this.email().trim(),
          otp_code: this.otpCode().trim(),
          challenge_token: this.mfaChallengeToken(),
          mode: 'mfa',
        }),
      (res) => this.finishAuth(res),
      'No se pudo confirmar el segundo factor.',
    );
  }

  private finishAuth(res: LoginResponse): void {
    if (!res.ok || !res.token || !res.user) {
      this.errorMsg.set(res.error ?? res.message ?? 'Respuesta de acceso incompleta.');
      return;
    }

    this.auth.login(res.token, res.user);
    this.router.navigate(['/dashboard']);
  }

  private run<T extends ApiResponse<unknown>>(
    request: () => Observable<T>,
    onSuccess: (res: T) => void,
    fallback: string,
  ): void {
    this.errorMsg.set(null);
    this.successMsg.set(null);
    this.isSubmitting.set(true);

    request().subscribe({
      next: (res) => {
        if (res.ok) onSuccess(res);
        else this.errorMsg.set(res.error ?? res.message ?? fallback);
        this.isSubmitting.set(false);
      },
      error: (err) => {
        this.errorMsg.set(this.getApiError(err, fallback));
        this.isSubmitting.set(false);
      },
    });
  }

  private getApiError(err: HttpErrorResponse | Error | null, fallback: string): string {
    if (!err) return fallback;
    if (err instanceof HttpErrorResponse) {
      return err.error?.error || err.error?.message || err.message || fallback;
    }
    return err.message || fallback;
  }
}
