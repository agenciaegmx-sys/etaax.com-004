/* ============================================================
   ETAAX — Modales en segundo plano (minimizar / restaurar)
   Cada ventana flotante gana un botón "—" en su encabezado que la
   MINIMIZA a una barra abajo (dock), manteniéndola VIVA con todo su
   estado (útil p.ej. para dejar un escandallo parqueado mientras
   agregas un insumo). Un clic en la pastilla la restaura.

   Trabaja sobre el ENCABEZADO y su overlay fijo (no necesita conocer
   la clase del contenedor). Se incluye como <script src="/modal-dock.js">.
   ============================================================ */
(function () {
    if (window._etxDock) return; window._etxDock = true;

    var HEADERS = '.modal-header,.dx-win-hdr,.cj-header,.tool-modal-hd,.etx-modal-hd';
    var CLOSE   = '.modal-close,.dx-win-close,.tm-x';

    var st = document.createElement('style');
    st.textContent =
        '#etx-dock{position:fixed;left:14px;bottom:14px;z-index:2147482000;display:flex;gap:8px;flex-wrap:wrap;max-width:74vw}' +
        '.etx-chip{display:flex;align-items:center;gap:8px;background:var(--surface,#1a1916);border:1px solid var(--border,#2e2c29);border-radius:10px;padding:7px 11px;box-shadow:0 8px 26px rgba(0,0,0,.45);font-family:DM Sans,system-ui,sans-serif;font-size:12px;color:var(--text,#f0ece4);cursor:pointer;animation:etxChip .16s ease both}' +
        '@keyframes etxChip{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
        '.etx-chip:hover{border-color:var(--green,#3dbe7a)}' +
        '.etx-chip .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}' +
        '.etx-chip .x{background:none;border:none;color:var(--text-dim,#8b867e);cursor:pointer;font-size:13px;line-height:1;padding:2px 2px;flex-shrink:0}' +
        '.etx-chip .x:hover{color:var(--red,#e05a3a)}' +
        '.etx-min-btn{background:transparent;border:1px solid var(--border,#2e2c29);color:var(--text-muted,#9a948b);border-radius:7px;min-width:26px;height:24px;cursor:pointer;font-size:15px;line-height:1;flex-shrink:0;font-family:inherit}' +
        '.etx-hd-btns{display:inline-flex;align-items:center;gap:6px;flex-shrink:0}' +
        '.etx-min-btn:hover{border-color:var(--green,#3dbe7a);color:var(--green,#3dbe7a)}';
    (document.head || document.documentElement).appendChild(st);

    var dock = document.createElement('div'); dock.id = 'etx-dock';
    function mountDock() { if (document.body && !dock.parentNode) document.body.appendChild(dock); }
    mountDock(); document.addEventListener('DOMContentLoaded', mountDock);

    function overlayOf(header) {
        var el = header;
        while (el && el !== document.body) {
            try { if (getComputedStyle(el).position === 'fixed') return el; } catch (e) {}
            el = el.parentElement;
        }
        return header.parentElement || header;
    }
    function titleOf(header) {
        var t = header.querySelector('.dx-win-title,.tm-tt,#iframeInsumoLabel,h2,h3');
        var txt = (t ? t.textContent : header.textContent) || 'Ventana';
        return (txt.replace(/[✕✖🗕—]/g, '').trim().slice(0, 42)) || 'Ventana';
    }

    function minimize(header) {
        var ov = overlayOf(header); if (!ov) return;
        mountDock();
        ov.__dockPrev = ov.style.display;
        ov.style.display = 'none';
        var chip = document.createElement('div'); chip.className = 'etx-chip';
        var sp = document.createElement('span'); sp.className = 't'; sp.textContent = '▢ ' + titleOf(header);
        var xb = document.createElement('button'); xb.className = 'x'; xb.type = 'button'; xb.title = 'Cerrar'; xb.textContent = '✕';
        chip.appendChild(sp); chip.appendChild(xb);
        chip.title = 'Restaurar';
        chip.addEventListener('click', function (e) { if (e.target === xb) return; ov.style.display = ov.__dockPrev || 'flex'; chip.remove(); });
        xb.addEventListener('click', function (e) {
            e.stopPropagation();
            ov.style.display = ov.__dockPrev || 'flex';   // mostrar para cerrar con su propia lógica
            var cl = header.querySelector(CLOSE) || ov.querySelector(CLOSE);
            if (cl) cl.click(); else ov.style.display = 'none';
            chip.remove();
        });
        dock.appendChild(chip);
    }

    function inject(header) {
        if (!header || header.querySelector('.etx-min-btn')) return;
        var b = document.createElement('button');
        b.className = 'etx-min-btn'; b.type = 'button'; b.title = 'Minimizar (segundo plano)'; b.textContent = '—';
        b.addEventListener('click', function (e) { e.stopPropagation(); minimize(header); });
        var close = header.querySelector(CLOSE);
        if (close) {
            // Agrupar minimizar + cerrar JUNTOS a la derecha (evita que el
            // space-between del header los separe).
            var wrap = document.createElement('span'); wrap.className = 'etx-hd-btns';
            close.parentNode.insertBefore(wrap, close);
            wrap.appendChild(b); wrap.appendChild(close);
        } else header.appendChild(b);
    }
    function scan(root) { try { (root || document).querySelectorAll(HEADERS).forEach(inject); } catch (e) {} }

    scan(); document.addEventListener('DOMContentLoaded', function () { scan(); });
    // Modales creados dinámicamente (p.ej. parámetros de nómina) → inyectar al aparecer.
    new MutationObserver(function (muts) {
        muts.forEach(function (m) {
            (m.addedNodes || []).forEach(function (nd) {
                if (nd.nodeType !== 1) return;
                if (nd.matches && nd.matches(HEADERS)) inject(nd);
                if (nd.querySelectorAll) scan(nd);
            });
        });
    }).observe(document.documentElement, { childList: true, subtree: true });
})();
