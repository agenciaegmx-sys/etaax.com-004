# Activar la confirmación de correo (Supabase Auth) — ETAAX

Guía de la configuración que hay que dejar lista **antes** de encender
"Confirmar registro", y las plantillas de correo listas para pegar.

> Las variables `{{ .ConfirmationURL }}`, `{{ .Email }}`… van **siempre en inglés**,
> aunque el panel de Supabase esté en español y muestre los chips traducidos
> ("{{ .Correo electrónico }}" es solo la etiqueta visual de `{{ .Email }}`).

---

## 1. SMTP propio (obligatorio antes de encender nada)

El correo integrado de Supabase es **solo para pruebas**: unos pocos envíos por
hora y sin garantía de entrega. Con clientes reales, un correo de confirmación
que no llega = un cliente que no puede entrar.

Supabase → Project Settings → Authentication → SMTP Settings:

| Campo | Valor |
|---|---|
| Sender email | `noreply@etaax.com` |
| Sender name | `ETAAX` |
| Host / Port / User / Pass | los del proveedor |

Proveedor sugerido: **Resend** (3,000 correos/mes gratis, alta sencilla con
dominio propio). Alternativas: Brevo, Amazon SES, SendGrid.

En el DNS de `etaax.com` hay que publicar los registros **SPF y DKIM** que dé el
proveedor. Sin eso los correos caen en spam.

Después, subir el límite en Authentication → Rate Limits → "Emails per hour"
(el default de 2/hora es de la caja de pruebas).

## 2. Configuración de URL

Authentication → URL Configuration:

- **Site URL**: `https://etaax.com/hub.html`
- **Redirect URLs** (allowlist): `https://etaax.com/**`

Sin esto, el link del correo manda a `localhost:3000` y el cliente ve un error.

## 3. Correr la migración v40

`supabase-migration-v40.sql` auto-confirma las cuentas internas
`staff.<negocioId>@etaax.app` que crea `staff-auth.js` para los colaboradores.
Ese buzón no existe, así que sin la migración el login de colaboradores de todo
negocio **nuevo** fallaría con "Email not confirmed".

## 4. Recién entonces, encender

Authentication → Correos electrónicos → **Confirmar registro** → activar.

Los usuarios que ya existen no se ven afectados (nacieron confirmados).

## 5. Prueba antes de dar de alta al primer cliente

1. Registrar una cuenta con un correo real propio desde `/hub.html`.
2. Que llegue el correo (revisar spam) y que el link entre a etaax.com.
3. Crear un negocio y entrar con un colaborador por NIP → confirma que v40 quedó bien.
4. Probar "¿Olvidaste tu contraseña?" y el cambio de correo desde Configuración.

---

## Plantillas (Authentication → Correos electrónicos)

Heredan la identidad de los reportes impresos (`reporte-marca.js`): wordmark
ETAAX, regla verde de 3px bajo el encabezado, títulos condensados en mayúsculas
con subrayado verde, tarjetas `#fafafa` y el pie de EGMx.

Diseño de correo, no de web: tablas, estilos en línea y nada de fuentes externas
— Gmail y Outlook no cargan CSS remoto, así que Bebas Neue cae con elegancia a
una condensada del sistema.

### Confirmar registro

**Dónde:** Authentication → Emails → Templates → Confirm signup
**Asunto:** `Confirma tu correo · ETAAX`

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;padding:26px 0;font-family:'DM Sans',Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e2e0">
      <tr><td style="padding:15px 22px;border-bottom:3px solid #3dbe7a">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://etaax.com/marca/etaax-logo-correo.png" width="128" height="28" alt="ETAAX" style="display:block;border:0;width:128px;height:28px;font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:22px;letter-spacing:2px;color:#1a1916"></td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:8.5px;letter-spacing:1.6px;text-transform:uppercase;color:#aaaaaa">Acceso a tu cuenta</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 22px 18px">
        <div style="font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:#1a1916;border-bottom:2px solid #3dbe7a;padding-bottom:6px;margin-bottom:16px">Confirma tu correo</div>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#55524d">Recibimos el registro de <b>{{ .Email }}</b> en ETAAX. Confirma tu direcci&oacute;n para activar el acceso a tu plataforma.</p>
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#3dbe7a;color:#0a0908;text-decoration:none;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-weight:700;font-size:14.5px;padding:13px 26px;border-radius:8px">Confirmar mi correo</a>
        <p style="margin:20px 0 0;font-size:11px;line-height:1.6;color:#8a8a8a">Si el bot&oacute;n no abre, copia esta direcci&oacute;n en tu navegador:<br>
          <span style="color:#3d8f66;word-break:break-all">{{ .ConfirmationURL }}</span></p>
        <p style="margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#8a8a8a">&iquest;No fuiste t&uacute;? Ignora este mensaje: sin confirmar, la cuenta no se activa.</p>
      </td></tr>
      <tr><td style="padding:11px 22px;border-top:1px solid #e8e8e8">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#aaaaaa">etaax.com &middot; EGMx Consultor&iacute;a Estrat&eacute;gica a&amp;b</td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#3dbe7a;font-weight:700">Alta de cuenta</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
```

### Restablecer contraseña

**Dónde:** Authentication → Emails → Templates → Reset password
**Asunto:** `Restablece tu contraseña · ETAAX`

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;padding:26px 0;font-family:'DM Sans',Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e2e0">
      <tr><td style="padding:15px 22px;border-bottom:3px solid #3dbe7a">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://etaax.com/marca/etaax-logo-correo.png" width="128" height="28" alt="ETAAX" style="display:block;border:0;width:128px;height:28px;font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:22px;letter-spacing:2px;color:#1a1916"></td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:8.5px;letter-spacing:1.6px;text-transform:uppercase;color:#aaaaaa">Acceso a tu cuenta</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 22px 18px">
        <div style="font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:#1a1916;border-bottom:2px solid #3dbe7a;padding-bottom:6px;margin-bottom:16px">Restablece tu contrase&ntilde;a</div>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#55524d">Pediste recuperar el acceso de <b>{{ .Email }}</b>. Este enlace sirve una sola vez y caduca en una hora.</p>
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#3dbe7a;color:#0a0908;text-decoration:none;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-weight:700;font-size:14.5px;padding:13px 26px;border-radius:8px">Crear contrase&ntilde;a nueva</a>
        <p style="margin:20px 0 0;font-size:11px;line-height:1.6;color:#8a8a8a">Si el bot&oacute;n no abre, copia esta direcci&oacute;n en tu navegador:<br>
          <span style="color:#3d8f66;word-break:break-all">{{ .ConfirmationURL }}</span></p>
        <p style="margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#8a8a8a">Si no lo pediste, ignora este mensaje: tu contrase&ntilde;a actual sigue funcionando.</p>
      </td></tr>
      <tr><td style="padding:11px 22px;border-top:1px solid #e8e8e8">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#aaaaaa">etaax.com &middot; EGMx Consultor&iacute;a Estrat&eacute;gica a&amp;b</td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#3dbe7a;font-weight:700">Recuperaci&oacute;n de acceso</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
```

### Cambiar dirección de correo

**Dónde:** Authentication → Emails → Templates → Change email address
**Asunto:** `Confirma tu nuevo correo · ETAAX`

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;padding:26px 0;font-family:'DM Sans',Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e2e0">
      <tr><td style="padding:15px 22px;border-bottom:3px solid #3dbe7a">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://etaax.com/marca/etaax-logo-correo.png" width="128" height="28" alt="ETAAX" style="display:block;border:0;width:128px;height:28px;font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:22px;letter-spacing:2px;color:#1a1916"></td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:8.5px;letter-spacing:1.6px;text-transform:uppercase;color:#aaaaaa">Acceso a tu cuenta</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 22px 18px">
        <div style="font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:#1a1916;border-bottom:2px solid #3dbe7a;padding-bottom:6px;margin-bottom:16px">Confirma tu nuevo correo</div>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#55524d">Pediste cambiar el correo de acceso de <b>{{ .Email }}</b> a <b>{{ .NewEmail }}</b>. Confirma para aplicar el cambio.</p>
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#3dbe7a;color:#0a0908;text-decoration:none;font-family:'DM Sans',Helvetica,Arial,sans-serif;font-weight:700;font-size:14.5px;padding:13px 26px;border-radius:8px">Confirmar el cambio</a>
        <p style="margin:20px 0 0;font-size:11px;line-height:1.6;color:#8a8a8a">Si el bot&oacute;n no abre, copia esta direcci&oacute;n en tu navegador:<br>
          <span style="color:#3d8f66;word-break:break-all">{{ .ConfirmationURL }}</span></p>
        <p style="margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#8a8a8a">Hasta que confirmes, sigues entrando con tu correo anterior.</p>
      </td></tr>
      <tr><td style="padding:11px 22px;border-top:1px solid #e8e8e8">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#aaaaaa">etaax.com &middot; EGMx Consultor&iacute;a Estrat&eacute;gica a&amp;b</td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#3dbe7a;font-weight:700">Cambio de correo</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
```

### Código de acceso (OTP)

**Dónde:** Authentication → Emails → Templates → Magic Link · sirve igual para Reauthentication
**Asunto:** `Tu código de acceso · ETAAX`

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;padding:26px 0;font-family:'DM Sans',Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e2e0">
      <tr><td style="padding:15px 22px;border-bottom:3px solid #3dbe7a">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://etaax.com/marca/etaax-logo-correo.png" width="128" height="28" alt="ETAAX" style="display:block;border:0;width:128px;height:28px;font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:22px;letter-spacing:2px;color:#1a1916"></td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:8.5px;letter-spacing:1.6px;text-transform:uppercase;color:#aaaaaa">Acceso a tu cuenta</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 22px 18px">
        <div style="font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:#1a1916;border-bottom:2px solid #3dbe7a;padding-bottom:6px;margin-bottom:16px">Tu c&oacute;digo de acceso</div>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#55524d">Escribe este c&oacute;digo en ETAAX para entrar.</p>
        <div style="border:1px solid #ececec;border-radius:9px;padding:14px 16px;background:#fafafa;text-align:center">
          <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:#999999;font-weight:700;margin-bottom:8px">C&oacute;digo de un solo uso</div>
          <div style="font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:34px;letter-spacing:10px;line-height:1;color:#1a1916">{{ .Token }}</div>
          <div style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9.5px;color:#8a8a8a;margin-top:8px">Caduca en una hora</div>
        </div>
        <p style="margin:18px 0 0;font-size:11.5px;line-height:1.6;color:#8a8a8a">Si no lo pediste, ignora este mensaje. Nadie puede entrar sin el c&oacute;digo.</p>
      </td></tr>
      <tr><td style="padding:11px 22px;border-top:1px solid #e8e8e8">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#aaaaaa">etaax.com &middot; EGMx Consultor&iacute;a Estrat&eacute;gica a&amp;b</td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#3dbe7a;font-weight:700">Verificaci&oacute;n</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
```

### Contraseña cambiada

**Dónde:** Authentication → Emails → Seguridad → flechita “›” del switch
**Asunto:** `Tu contraseña de ETAAX cambió`

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;padding:26px 0;font-family:'DM Sans',Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e2e0">
      <tr><td style="padding:15px 22px;border-bottom:3px solid #3dbe7a">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://etaax.com/marca/etaax-logo-correo.png" width="128" height="28" alt="ETAAX" style="display:block;border:0;width:128px;height:28px;font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:22px;letter-spacing:2px;color:#1a1916"></td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:8.5px;letter-spacing:1.6px;text-transform:uppercase;color:#aaaaaa">Aviso de seguridad</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 22px 18px">
        <div style="font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:#1a1916;border-bottom:2px solid #3dbe7a;padding-bottom:6px;margin-bottom:16px">Tu contrase&ntilde;a cambi&oacute;</div>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#55524d">La contrase&ntilde;a de acceso a tu cuenta de ETAAX se cambi&oacute; hace unos momentos. Si fuiste t&uacute;, no tienes que hacer nada.</p>
        <div style="border:1px solid #f0e2c4;border-left:4px solid #d9a441;border-radius:9px;padding:13px 16px;background:#fdf6ec">
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:#6b5836"><b>&iquest;No fuiste t&uacute;?</b> Entra a etaax.com, usa &ldquo;&iquest;Olvidaste tu contrase&ntilde;a?&rdquo; para recuperar el control y av&iacute;sanos de inmediato.</p>
        </div>
      </td></tr>
      <tr><td style="padding:11px 22px;border-top:1px solid #e8e8e8">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#aaaaaa">etaax.com &middot; EGMx Consultor&iacute;a Estrat&eacute;gica a&amp;b</td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#3dbe7a;font-weight:700">Seguridad de la cuenta</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
```

### Correo cambiado

**Dónde:** Authentication → Emails → Seguridad → flechita “›” del switch
**Asunto:** `Tu correo de acceso a ETAAX cambió`

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;padding:26px 0;font-family:'DM Sans',Helvetica,Arial,sans-serif">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e2e0">
      <tr><td style="padding:15px 22px;border-bottom:3px solid #3dbe7a">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://etaax.com/marca/etaax-logo-correo.png" width="128" height="28" alt="ETAAX" style="display:block;border:0;width:128px;height:28px;font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:22px;letter-spacing:2px;color:#1a1916"></td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:8.5px;letter-spacing:1.6px;text-transform:uppercase;color:#aaaaaa">Aviso de seguridad</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:24px 22px 18px">
        <div style="font-family:'Bebas Neue','Arial Narrow',Arial,Helvetica,sans-serif;font-size:19px;letter-spacing:2px;text-transform:uppercase;color:#1a1916;border-bottom:2px solid #3dbe7a;padding-bottom:6px;margin-bottom:16px">Tu correo de acceso cambi&oacute;</div>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.65;color:#55524d">El correo con el que entras a ETAAX se acaba de cambiar. A partir de ahora inicia sesi&oacute;n con la direcci&oacute;n nueva.</p>
        <div style="border:1px solid #f0e2c4;border-left:4px solid #d9a441;border-radius:9px;padding:13px 16px;background:#fdf6ec">
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:#6b5836"><b>&iquest;No fuiste t&uacute;?</b> Cont&aacute;ctanos de inmediato: quien haya hecho el cambio tiene acceso a tu cuenta.</p>
        </div>
      </td></tr>
      <tr><td style="padding:11px 22px;border-top:1px solid #e8e8e8">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#aaaaaa">etaax.com &middot; EGMx Consultor&iacute;a Estrat&eacute;gica a&amp;b</td>
          <td align="right" style="font-family:'DM Sans',Helvetica,Arial,sans-serif;font-size:9px;color:#3dbe7a;font-weight:700">Seguridad de la cuenta</td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>
</table>
```

---

## Notas

- **Enlace mágico / OTP, Invitar usuario, Reautenticación**: la app no los usa
  hoy; se pueden dejar como están.
- **Sección Seguridad** (contraseña cambiada, correo cambiado, MFA…): son avisos
  informativos, no bloquean nada. El único que vale la pena encender es
  "Contraseña cambiada" — avisa al dueño si alguien le cambia el acceso.
- El cambio de correo pide doble confirmación por default (llega correo a la
  dirección vieja y a la nueva). `configuracion.html` ya lo contempla: si el
  cambio no es inmediato, avisa "el cambio se aplicará al confirmarlo".
