import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LoginComponent } from './login';

describe('LoginComponent — recuperación de contraseña', () => {
  let component: LoginComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    component = TestBed.createComponent(LoginComponent).componentInstance;
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http?.verify();
  });

  /** Deja el componente en el paso 'password', que es donde vive el enlace. */
  function llegarAPasoPassword(): void {
    component.email.set('demo@emeltec.cl');
    component.handleSubmit(new Event('submit'));
    http.expectOne('/api/auth/start').flush({ ok: true, flow: 'password' });
  }

  it('parte en el paso de correo', () => {
    expect(component.step()).toBe('email');
    expect(component.isRecoveryStep()).toBe(false);
  });

  it('goToRecovery entra al paso de contraseña nueva y limpia lo escrito', () => {
    llegarAPasoPassword();
    component.password.set('lo-que-sea');

    component.goToRecovery();

    expect(component.step()).toBe('recover_password');
    expect(component.password()).toBe('');
    expect(component.isRecoveryStep()).toBe(true);
    expect(component.isNewPasswordStep()).toBe(true);
  });

  it('no habilita el envío con una contraseña que no cumple la política', () => {
    llegarAPasoPassword();
    component.goToRecovery();

    component.password.set('12345678');
    component.confirmPassword.set('12345678');
    expect(component.canSubmitCurrentStep()).toBe(false);

    component.password.set('Emeltec2026!');
    component.confirmPassword.set('Emeltec2025!');
    expect(component.canSubmitCurrentStep()).toBe(false);

    component.confirmPassword.set('Emeltec2026!');
    expect(component.canSubmitCurrentStep()).toBe(true);
  });

  it('recorre start → OTP → éxito y vuelve al paso de contraseña', () => {
    llegarAPasoPassword();
    component.goToRecovery();
    component.password.set('Emeltec2026!');
    component.confirmPassword.set('Emeltec2026!');

    component.handleSubmit(new Event('submit'));
    const start = http.expectOne('/api/auth/recover/start');
    expect(start.request.body).toEqual({
      email: 'demo@emeltec.cl',
      new_password: 'Emeltec2026!',
    });
    start.flush({ ok: true, reset_token: 'tok-1', message: 'Codigo enviado.' });

    expect(component.step()).toBe('recover_otp');
    expect(component.isOtpStep()).toBe(true);

    component.otpCode.set('A2B3C4');
    component.handleSubmit(new Event('submit'));
    const complete = http.expectOne('/api/auth/recover/complete');
    expect(complete.request.body).toEqual({
      email: 'demo@emeltec.cl',
      new_password: 'Emeltec2026!',
      otp_code: 'A2B3C4',
      reset_token: 'tok-1',
    });
    complete.flush({ ok: true, message: 'Contrasena actualizada.' });

    // Sin auto-login: vuelve a pedir la contraseña.
    expect(component.step()).toBe('password');
    expect(component.successMsg()).toBe('Contrasena actualizada.');
    expect(component.password()).toBe('');
    expect(component.resetToken()).toBe('');
  });

  it('reenviar código repite /recover/start sin perder la contraseña escrita', () => {
    llegarAPasoPassword();
    component.goToRecovery();
    component.password.set('Emeltec2026!');
    component.confirmPassword.set('Emeltec2026!');
    component.handleSubmit(new Event('submit'));
    http.expectOne('/api/auth/recover/start').flush({ ok: true, reset_token: 'tok-1' });

    component.resendCode();
    const reenvio = http.expectOne('/api/auth/recover/start');
    expect(reenvio.request.body.new_password).toBe('Emeltec2026!');
    reenvio.flush({ ok: true, reset_token: 'tok-2' });

    expect(component.step()).toBe('recover_otp');
    expect(component.resetToken()).toBe('tok-2');
  });

  it('cancelar la recuperación devuelve al paso de contraseña, no al de correo', () => {
    llegarAPasoPassword();
    component.goToRecovery();

    component.goBack();

    expect(component.step()).toBe('password');
    expect(component.email()).toBe('demo@emeltec.cl');
  });

  it('desde un paso que no es de recuperación, volver lleva al correo', () => {
    llegarAPasoPassword();

    component.goBack();

    expect(component.step()).toBe('email');
  });

  it('propaga el error de la API al banner', () => {
    llegarAPasoPassword();
    component.goToRecovery();
    component.password.set('Emeltec2026!');
    component.confirmPassword.set('Emeltec2026!');
    component.handleSubmit(new Event('submit'));

    http
      .expectOne('/api/auth/recover/start')
      .flush(
        { ok: false, error: 'Demasiadas solicitudes.' },
        { status: 429, statusText: 'Too Many Requests' },
      );

    expect(component.errorMsg()).toBe('Demasiadas solicitudes.');
    expect(component.step()).toBe('recover_password');
  });
});
