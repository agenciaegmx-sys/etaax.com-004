/* Capa visual del modal compartido. No interviene en la contraseña, la sesión,
   los permisos, el verificador ni sus callbacks. */
(function () {
    'use strict';
    var pendiente = false;
    function icono(el, nombre) {
        if (!el || typeof window.etaaxIcono !== 'function') return;
        var actual = el.querySelector(':scope > .a-ui-icon');
        if (actual && actual.dataset.icono === nombre) return;
        if (actual) actual.remove();
        el.querySelectorAll(':scope > .etx-emoji-slot').forEach(function (n) { n.remove(); });
        Array.from(el.childNodes).forEach(function (n) {
            if (n.nodeType === 3) n.textContent = n.textContent.replace(/^[\s🔒🔓👁🙈\uFE0F]+/u, '');
        });
        var s = document.createElement('span'); s.className = 'a-ui-icon'; s.dataset.icono = nombre;
        s.setAttribute('aria-hidden', 'true'); s.innerHTML = window.etaaxIcono('aut-' + nombre, {tam:20});
        el.insertBefore(s, el.firstChild); el.dataset.etxEmoji = '1';
    }
    function pintar() {
        pendiente = false;
        var modal = document.getElementById('modalAdminGuard');
        if (modal) {
            icono(modal.querySelector(':scope > div > div:first-child > div:first-child'), 'candado');
            var campo = document.getElementById('adminGuardInput'), ojo = document.getElementById('adminGuardEye');
            icono(ojo, campo && campo.type === 'text' ? 'ocultar' : 'mostrar');
            if (ojo) ojo.setAttribute('aria-label', campo && campo.type === 'text' ? 'Ocultar contraseña' : 'Mostrar contraseña');
            var boton = document.getElementById('adminGuardBtn');
            if (boton && !/Verificando/.test(boton.textContent)) {
                boton.classList.toggle('a-danger', /^(Eliminar|Borrar)/i.test(boton.textContent.trim()));
                icono(boton, 'autorizar');
            }
        }
        document.querySelectorAll('.etaax-ui-ov').forEach(function (ov) {
            var mensaje = ov.querySelector('.etaax-ui-msg');
            if (mensaje && /^Autorizado por: /.test(mensaje.textContent)) {
                ov.classList.add('a-authorized'); icono(ov.querySelector('.etaax-ui-card'), 'autorizado');
            }
        });
    }
    function iniciar() {
        pintar();
        new MutationObserver(function (cambios) {
            if (pendiente) return;
            if (cambios.some(function (m) {
                var el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                return el && (el.closest('#modalAdminGuard,.etaax-ui-ov') || Array.from(m.addedNodes).some(function (n) {
                    return n.nodeType === 1 && n.matches('#modalAdminGuard,.etaax-ui-ov');
                }));
            })) { pendiente = true; window.requestAnimationFrame(pintar); }
        }).observe(document.body, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['type']});
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
